use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use yot_server::auth::pairing::PairingService;
use yot_server::auth::rate_limit::RateLimiter;
use yot_server::core::event_bus::EventBus;
use yot_server::db::Db;
use yot_server::mcp::server::McpServer;
use yot_server::rest::oauth::AuthCodeStore;
use yot_server::rest::{self, AppState};

struct Harness {
    app: Router,
    db: Db,
    pairing: Arc<PairingService>,
}

fn harness() -> Harness {
    let db = Db::open_in_memory().unwrap();
    let bus = EventBus::new();
    let pairing = Arc::new(PairingService::new());

    let mcp_conn = rusqlite::Connection::open_in_memory().unwrap();
    yot_server::db::schema::initialize(&mcp_conn).unwrap();
    let mcp = Arc::new(McpServer {
        conn: Mutex::new(mcp_conn),
        scope: "write".to_string(),
        bus: bus.clone(),
    });

    let config = Arc::new(yot_server::config::Config {
        port: 4010,
        data_dir: std::env::temp_dir().clone(),
        db_path: std::env::temp_dir().join("unused-test.db"),
        img_dir: std::env::temp_dir().join("unused-test-img"),
        plugin_dir: std::env::temp_dir().join("unused-test-plugins"),
        mcp_auth: true,
        yot_api_key: None,
        yot_http_url: None,
        yot_sse_relay: false,
        hermes_api_url: "http://127.0.0.1:1/v1/chat/completions".to_string(),
        hermes_api_key: None,
        hermes_default_model: "test".to_string(),
        hermes_allowed_models: vec![],
    });

    let state = AppState {
        db: db.clone(),
        bus,
        pairing: pairing.clone(),
        rate_limiter: Arc::new(RateLimiter::new()),
        mcp,
        auth_codes: Arc::new(AuthCodeStore::new()),
        http_client: reqwest::Client::new(),
        config,
    };

    Harness { app: rest::build_router(state), db, pairing }
}

/// The pair handler extracts ConnectInfo for rate limiting, which `oneshot`
/// does not populate on its own.
async fn call(app: &Router, mut req: Request<Body>) -> (StatusCode, HeaderMap, Value) {
    req.extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40000))));
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, headers, body)
}

fn pair_req(body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/auth/pair")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn authed(method: &str, uri: &str, key: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {key}"))
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn native_pair_returns_key_in_body_without_cookie() {
    let h = harness();
    let pin = h.pairing.generate_pin("write");

    let (status, headers, body) =
        call(&h.app, pair_req(json!({"pin": pin, "client": "native"}))).await;

    assert_eq!(status, StatusCode::OK);
    assert!(headers.get("set-cookie").is_none());
    assert_eq!(body["ok"], true);
    assert_eq!(body["scope"], "write");
    let key = body["key"].as_str().expect("key present in body");
    assert!(key.starts_with("cal_"));

    let (status, _, body) = call(&h.app, authed("GET", "/api/auth/session", key)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["scope"], "write");
}

#[tokio::test]
async fn web_pair_sets_cookie_and_omits_key() {
    let h = harness();
    let pin = h.pairing.generate_pin("write");

    let (status, headers, body) = call(&h.app, pair_req(json!({"pin": pin}))).await;

    assert_eq!(status, StatusCode::OK);
    let cookie = headers.get("set-cookie").unwrap().to_str().unwrap();
    assert!(cookie.starts_with("yot_session=cal_"));
    assert_eq!(body["ok"], true);
    assert!(body.get("key").is_none());
}

#[tokio::test]
async fn native_pair_preserves_read_scope() {
    let h = harness();
    let pin = h.pairing.generate_pin("read");

    let (status, _, body) = call(&h.app, pair_req(json!({"pin": pin, "client": "native"}))).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["scope"], "read");

    let key = body["key"].as_str().unwrap();
    let (status, _, _) = call(&h.app, authed("POST", "/api/auth/pin", key)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn device_name_becomes_key_name() {
    let h = harness();
    let pin = h.pairing.generate_pin("write");

    let (status, _, _) = call(
        &h.app,
        pair_req(json!({"pin": pin, "client": "native", "device_name": "  My Phone  "})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let keys = h.db.call(yot_server::auth::apikey::list_keys).await.unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].name, "My Phone");
}

#[tokio::test]
async fn key_name_defaults_by_client() {
    let h = harness();

    let native_pin = h.pairing.generate_pin("write");
    call(&h.app, pair_req(json!({"pin": native_pin, "client": "native"}))).await;

    let web_pin = h.pairing.generate_pin("write");
    call(&h.app, pair_req(json!({"pin": web_pin}))).await;

    let keys = h.db.call(yot_server::auth::apikey::list_keys).await.unwrap();
    let names: Vec<&str> = keys.iter().map(|k| k.name.as_str()).collect();
    assert!(names.contains(&"native"), "got {names:?}");
    assert!(names.contains(&"web"), "got {names:?}");
}

#[tokio::test]
async fn logout_revokes_bearer_key() {
    let h = harness();
    let pin = h.pairing.generate_pin("write");
    let (_, _, body) = call(&h.app, pair_req(json!({"pin": pin, "client": "native"}))).await;
    let key = body["key"].as_str().unwrap().to_string();

    let (status, _, _) = call(&h.app, authed("POST", "/api/auth/logout", &key)).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = call(&h.app, authed("GET", "/api/auth/session", &key)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn logout_still_revokes_cookie_key() {
    let h = harness();
    let pin = h.pairing.generate_pin("write");
    let (_, headers, _) = call(&h.app, pair_req(json!({"pin": pin}))).await;
    let cookie = headers.get("set-cookie").unwrap().to_str().unwrap();
    let key = cookie
        .split(';')
        .next()
        .unwrap()
        .trim_start_matches("yot_session=")
        .to_string();

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/logout")
        .header("cookie", format!("yot_session={key}"))
        .body(Body::empty())
        .unwrap();
    let (status, headers, _) = call(&h.app, req).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        headers
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );

    let (status, _, _) = call(&h.app, authed("GET", "/api/auth/session", &key)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
