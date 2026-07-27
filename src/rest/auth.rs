use std::net::SocketAddr;
use axum::{Router, Json, extract::{ConnectInfo, State, Extension}};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use serde::Deserialize;
use serde_json::json;
use crate::auth::middleware::AuthContext;
use crate::core::error::AppError;
use crate::rest::AppState;

pub fn public_routes() -> Router<AppState> {
    use axum::routing::post;
    Router::new()
        .route("/auth/pair", post(pair))
        .route("/auth/logout", post(logout))
}

pub fn protected_routes() -> Router<AppState> {
    use axum::routing::{get, post};
    Router::new()
        .route("/auth/pin", post(generate_pin))
        .route("/auth/session", get(get_session))
}

const MAX_KEY_NAME_LEN: usize = 64;

#[derive(Deserialize)]
struct PairInput {
    pin: String,
    /// "native" makes the key come back in the response body instead of a
    /// cookie, for clients without a cookie jar. Anything else behaves as before.
    client: Option<String>,
    device_name: Option<String>,
}

fn key_name(device_name: Option<&str>, is_native: bool) -> String {
    let trimmed = device_name.map(str::trim).filter(|s| !s.is_empty());
    match trimmed {
        Some(name) => name.chars().take(MAX_KEY_NAME_LEN).collect(),
        None if is_native => "native".to_string(),
        None => "web".to_string(),
    }
}

async fn pair(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers_in: HeaderMap,
    Json(input): Json<PairInput>,
) -> Result<impl IntoResponse, AppError> {
    let ip = addr.ip();

    if !state.rate_limiter.check(ip) {
        return Err(AppError::rate_limited("Too many attempts"));
    }

    let scope = match state.pairing.redeem(&input.pin) {
        Some(s) => s,
        None => {
            state.rate_limiter.record_failure(ip);
            return Err(AppError::unauthorized("Invalid or expired PIN"));
        }
    };

    state.rate_limiter.clear(ip);

    let is_native = input.client.as_deref() == Some("native");
    let name = key_name(input.device_name.as_deref(), is_native);

    let (_, raw_key) = state.db.call({
        let scope = scope.clone();
        move |conn| crate::auth::apikey::create(conn, &name, &scope)
    }).await?;

    let mut headers = HeaderMap::new();

    if is_native {
        return Ok((
            StatusCode::OK,
            headers,
            Json(json!({"ok": true, "scope": scope, "key": raw_key})),
        ));
    }

    let is_https = headers_in
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.eq_ignore_ascii_case("https"))
        .unwrap_or(false);

    let secure_flag = if is_https { "; Secure" } else { "" };
    let cookie = format!(
        "yot_session={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000{}",
        raw_key, secure_flag
    );

    headers.insert("Set-Cookie", cookie.parse().unwrap());

    Ok((StatusCode::OK, headers, Json(json!({"ok": true, "scope": scope}))))
}

async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    let cookie_header = headers.get("cookie").and_then(|v| v.to_str().ok());
    // Native clients present the key as a header, browsers as a cookie. The
    // query param is deliberately not accepted here — logout is never a GET.
    if let Some(key) = crate::auth::middleware::extract_raw_key(&headers, None, cookie_header) {
        state.db.call(move |conn| {
            crate::auth::apikey::revoke(conn, &key)
        }).await?;
    }

    let clear_cookie = "yot_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    let mut resp_headers = HeaderMap::new();
    resp_headers.insert("Set-Cookie", clear_cookie.parse().unwrap());

    Ok((StatusCode::OK, resp_headers, Json(json!({"ok": true}))))
}

#[derive(Deserialize)]
struct PinInput {
    scope: Option<String>,
}

async fn generate_pin(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<PinInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut scope = input.scope.unwrap_or_else(|| "write".to_string());
    if scope != "read" {
        scope = "write".to_string();
    }
    if auth.key.scope == "read" {
        scope = "read".to_string();
    }

    let pin = state.pairing.generate_pin(&scope);
    Ok(Json(json!({
        "pin": pin,
        "scope": scope,
        "expires_in": 300,
    })))
}

async fn get_session(
    Extension(auth): Extension<AuthContext>,
) -> Json<serde_json::Value> {
    Json(json!({"scope": auth.key.scope}))
}
