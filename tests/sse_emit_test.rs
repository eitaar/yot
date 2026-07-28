//! The live-sync pipeline hinges on every mutation reaching the event bus:
//! the SSE stream and the stdio-MCP relay are both plain bus subscribers.
//! These tests pin the emits for the paths that used to silently skip them
//! (reminders, ICS import) and the /api/internal/events relay endpoint.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

use yot_server::auth::pairing::PairingService;
use yot_server::auth::rate_limit::RateLimiter;
use yot_server::core::event_bus::{BusEvent, EventBus};
use yot_server::db::Db;
use yot_server::mcp::server::McpServer;
use yot_server::rest::oauth::AuthCodeStore;
use yot_server::rest::{self, AppState};

struct Harness {
    app: Router,
    bus: EventBus,
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

    let state = AppState {
        db,
        bus: bus.clone(),
        pairing: pairing.clone(),
        rate_limiter: Arc::new(RateLimiter::new()),
        mcp,
        auth_codes: Arc::new(AuthCodeStore::new()),
    };

    Harness { app: rest::build_router(state), bus, pairing }
}

/// The pair handler extracts ConnectInfo for rate limiting, which `oneshot`
/// does not populate on its own.
async fn call(app: &Router, mut req: Request<Body>) -> (StatusCode, Value) {
    req.extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40000))));
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

async fn api_key(h: &Harness) -> String {
    let pin = h.pairing.generate_pin("write");
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/pair")
        .header("content-type", "application/json")
        .body(Body::from(json!({"pin": pin, "client": "native"}).to_string()))
        .unwrap();
    let (status, body) = call(&h.app, req).await;
    assert_eq!(status, StatusCode::OK);
    body["key"].as_str().unwrap().to_string()
}

fn authed_json(method: &str, uri: &str, key: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {key}"))
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

/// Drain everything currently buffered so the next assertion only sees
/// events emitted by the action under test.
fn drain(rx: &mut Receiver<BusEvent>) {
    while rx.try_recv().is_ok() {}
}

fn recv_type(rx: &mut Receiver<BusEvent>) -> String {
    rx.try_recv().expect("expected a bus event").event_type
}

async fn make_event(h: &Harness, key: &str) -> String {
    let (status, cal) = call(
        &h.app,
        authed_json("POST", "/api/calendars", key, json!({"name": "Test"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, ev) = call(
        &h.app,
        authed_json(
            "POST",
            "/api/events",
            key,
            json!({
                "calendar_id": cal["id"],
                "title": "Meeting",
                "start_at": "2026-06-02T14:00:00Z",
                "end_at": "2026-06-02T15:00:00Z",
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    ev["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn reminder_endpoints_emit_event_updated() {
    let h = harness();
    let key = api_key(&h).await;
    let event_id = make_event(&h, &key).await;

    let mut rx = h.bus.subscribe();
    let (status, reminder) = call(
        &h.app,
        authed_json(
            "POST",
            &format!("/api/events/{event_id}/reminders"),
            &key,
            json!({"minutes_before": 10, "method": "notification"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(recv_type(&mut rx), "event.updated");

    drain(&mut rx);
    let rid = reminder["id"].as_str().unwrap();
    let (status, _) = call(
        &h.app,
        authed(
            "DELETE",
            &format!("/api/events/{event_id}/reminders/{rid}"),
            &key,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(recv_type(&mut rx), "event.updated");
}

#[tokio::test]
async fn ics_import_emits_single_event_created() {
    let h = harness();
    let key = api_key(&h).await;

    let (status, cal) = call(
        &h.app,
        authed_json("POST", "/api/calendars", &key, json!({"name": "Imported"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let cal_id = cal["id"].as_str().unwrap();

    let ics = "BEGIN:VCALENDAR\r\n\
        BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:One\r\nDTSTART:20260602T140000Z\r\nDTEND:20260602T150000Z\r\nEND:VEVENT\r\n\
        BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Two\r\nDTSTART:20260603T140000Z\r\nDTEND:20260603T150000Z\r\nEND:VEVENT\r\n\
        END:VCALENDAR";
    let boundary = "XBOUNDARY";
    let body = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"calendar_id\"\r\n\r\n{cal_id}\r\n\
         --{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"cal.ics\"\r\n\
         Content-Type: text/calendar\r\n\r\n{ics}\r\n\
         --{boundary}--\r\n"
    );
    let import_req = |body: String| {
        Request::builder()
            .method("POST")
            .uri("/api/events/import")
            .header("authorization", format!("Bearer {key}"))
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .unwrap()
    };

    let mut rx = h.bus.subscribe();
    let (status, result) = call(&h.app, import_req(body.clone())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["created"], 2);
    // One coarse broadcast per import, not one per created event.
    assert_eq!(recv_type(&mut rx), "event.created");
    assert!(rx.try_recv().is_err());

    // A re-import creates nothing and must stay silent.
    let (status, result) = call(&h.app, import_req(body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["created"], 0);
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn internal_relay_endpoint_emits_on_bus() {
    let h = harness();
    let key = api_key(&h).await;

    let mut rx = h.bus.subscribe();
    let (status, _) = call(
        &h.app,
        authed_json(
            "POST",
            "/api/internal/events",
            &key,
            json!({"type": "event.created", "data": {"id": "e1"}}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let event = rx.try_recv().expect("relayed event reaches the bus");
    assert_eq!(event.event_type, "event.created");
    assert_eq!(event.data["id"], "e1");
}

#[tokio::test]
async fn internal_relay_endpoint_rejects_bad_type_and_missing_auth() {
    let h = harness();
    let key = api_key(&h).await;

    let mut rx = h.bus.subscribe();
    let (status, _) = call(
        &h.app,
        authed_json(
            "POST",
            "/api/internal/events",
            &key,
            json!({"type": "not a valid type!", "data": {}}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(rx.try_recv().is_err());

    let req = Request::builder()
        .method("POST")
        .uri("/api/internal/events")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"type": "event.created", "data": {}}).to_string(),
        ))
        .unwrap();
    let (status, _) = call(&h.app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(rx.try_recv().is_err());
}
