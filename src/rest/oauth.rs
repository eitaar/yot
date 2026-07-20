use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::AppState;
use crate::auth::apikey::hash_key;

const ALLOWED_REDIRECT_PREFIXES: &[&str] = &[
    "https://claude.ai/",
    "http://localhost/",
    "http://localhost:",
    "http://127.0.0.1/",
    "http://127.0.0.1:",
];

fn is_redirect_allowed(uri: &str) -> bool {
    if uri.contains('@') || uri.contains('\\') {
        return false;
    }
    ALLOWED_REDIRECT_PREFIXES.iter().any(|p| uri.starts_with(p))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

pub struct AuthCodeStore {
    codes: Mutex<HashMap<String, StoredCode>>,
}

struct StoredCode {
    code_challenge: String,
    api_key: String,
    redirect_uri: String,
    expires_at: Instant,
}

impl AuthCodeStore {
    pub fn new() -> Self {
        Self { codes: Mutex::new(HashMap::new()) }
    }

    fn insert(&self, code: String, challenge: String, api_key: String, redirect_uri: String) {
        let mut map = self.codes.lock().unwrap();
        map.retain(|_, v| v.expires_at > Instant::now());
        map.insert(code, StoredCode {
            code_challenge: challenge,
            api_key,
            redirect_uri,
            expires_at: Instant::now() + Duration::from_secs(300),
        });
    }

    fn redeem(&self, code: &str, code_verifier: &str, redirect_uri: &str) -> Option<String> {
        let mut map = self.codes.lock().unwrap();
        let stored = map.remove(code)?;
        if stored.expires_at < Instant::now() {
            return None;
        }
        if stored.redirect_uri != redirect_uri {
            return None;
        }
        let mut hasher = Sha256::new();
        hasher.update(code_verifier.as_bytes());
        let computed = URL_SAFE_NO_PAD.encode(hasher.finalize());
        if computed != stored.code_challenge {
            return None;
        }
        Some(stored.api_key)
    }
}

fn base_url_from_headers(headers: &HeaderMap) -> String {
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    format!("{proto}://{host}")
}

pub async fn protected_resource_metadata(headers: HeaderMap) -> impl IntoResponse {
    let base = base_url_from_headers(&headers);
    Json(json!({
        "resource": base,
        "authorization_servers": [base]
    }))
}

pub async fn authorization_server_metadata(headers: HeaderMap) -> impl IntoResponse {
    let base = base_url_from_headers(&headers);
    Json(json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}/authorize"),
        "token_endpoint": format!("{base}/oauth/token"),
        "registration_endpoint": format!("{base}/oauth/register"),
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
        "grant_types_supported": ["authorization_code"],
        "response_types_supported": ["code"],
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": ["read", "write"]
    }))
}

#[derive(Deserialize)]
pub struct AuthorizeQuery {
    response_type: Option<String>,
    client_id: Option<String>,
    redirect_uri: Option<String>,
    code_challenge: Option<String>,
    #[allow(dead_code)]
    code_challenge_method: Option<String>,
    state: Option<String>,
    #[allow(dead_code)]
    resource: Option<String>,
}

pub async fn authorize_page(Query(q): Query<AuthorizeQuery>) -> impl IntoResponse {
    if q.response_type.as_deref() != Some("code") {
        return (StatusCode::BAD_REQUEST, Html("Invalid response_type".to_string())).into_response();
    }
    let redirect_uri = q.redirect_uri.unwrap_or_default();
    if !is_redirect_allowed(&redirect_uri) {
        return (StatusCode::BAD_REQUEST, Html("Invalid redirect_uri".to_string())).into_response();
    }
    let code_challenge = q.code_challenge.unwrap_or_default();
    let state = q.state.unwrap_or_default();
    let client_id = q.client_id.unwrap_or_default();

    let esc_client_id = html_escape(&client_id);
    let esc_redirect_uri = html_escape(&redirect_uri);
    let esc_code_challenge = html_escape(&code_challenge);
    let esc_state = html_escape(&state);

    let html = format!(r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>yot — Authorize</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}}
.card{{max-width:380px;width:100%;padding:2rem}}
h1{{font-size:1.25rem;margin-bottom:.5rem}}
p{{color:#999;font-size:.875rem;margin-bottom:1.5rem}}
label{{display:block;font-size:.8rem;color:#888;margin-bottom:.25rem}}
input{{width:100%;padding:.6rem .75rem;background:#1a1a1a;border:1px solid #333;border-radius:6px;color:#fff;font-size:.9rem;margin-bottom:1rem}}
input:focus{{outline:none;border-color:#666}}
button{{width:100%;padding:.7rem;background:#fff;color:#000;border:none;border-radius:6px;font-size:.9rem;font-weight:500;cursor:pointer}}
button:hover{{background:#ddd}}
.hint{{color:#666;font-size:.75rem;margin-top:.75rem}}
</style></head><body>
<div class="card">
<h1>yot</h1>
<p>Authorize <strong>{esc_client_id}</strong> to access your calendar</p>
<form method="POST" action="/authorize">
<input type="hidden" name="redirect_uri" value="{esc_redirect_uri}">
<input type="hidden" name="code_challenge" value="{esc_code_challenge}">
<input type="hidden" name="state" value="{esc_state}">
<label>API Key</label>
<input type="password" name="api_key" placeholder="cal_..." required autofocus>
<button type="submit">Authorize</button>
</form>
<p class="hint">Enter your yot API key. Run <code>yot keys</code> to see available keys.</p>
</div></body></html>"#);

    Html(html).into_response()
}

#[derive(Deserialize)]
pub struct AuthorizeForm {
    api_key: String,
    redirect_uri: String,
    code_challenge: String,
    state: String,
}

pub async fn authorize_submit(
    State(state): State<AppState>,
    axum::Form(form): axum::Form<AuthorizeForm>,
) -> impl IntoResponse {
    if !is_redirect_allowed(&form.redirect_uri) {
        return (StatusCode::BAD_REQUEST, Html("Invalid redirect_uri".to_string())).into_response();
    }
    let db = state.db.clone();
    let api_key = form.api_key.clone();
    let valid = db.call(move |conn| {
        let hash = hash_key(&api_key);
        let found = conn.query_row(
            "SELECT id FROM api_keys WHERE key_hash = ? AND revoked = 0",
            [&hash],
            |_| Ok(()),
        ).is_ok();
        Ok(found)
    }).await.unwrap_or(false);

    if !valid {
        return (StatusCode::UNAUTHORIZED, Html(
            "<html><body style='font-family:system-ui;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;height:100vh'><p>Invalid API key. <a href='javascript:history.back()' style='color:#888'>Try again</a></p></body></html>".to_string()
        )).into_response();
    }

    let code = generate_code();
    state.auth_codes.insert(
        code.clone(),
        form.code_challenge,
        form.api_key,
        form.redirect_uri.clone(),
    );

    let redirect = format!("{}?code={}&state={}", form.redirect_uri, code, form.state);
    Redirect::temporary(&redirect).into_response()
}

#[derive(Deserialize)]
pub struct TokenRequest {
    grant_type: String,
    code: Option<String>,
    code_verifier: Option<String>,
    redirect_uri: Option<String>,
    #[allow(dead_code)]
    client_id: Option<String>,
    client_secret: Option<String>,
}

pub async fn token(
    State(state): State<AppState>,
    axum::Form(form): axum::Form<TokenRequest>,
) -> impl IntoResponse {
    match form.grant_type.as_str() {
        "authorization_code" => {
            let code = form.code.unwrap_or_default();
            let verifier = form.code_verifier.unwrap_or_default();
            let redirect_uri = form.redirect_uri.unwrap_or_default();

            match state.auth_codes.redeem(&code, &verifier, &redirect_uri) {
                Some(api_key) => (
                    StatusCode::OK,
                    [(header::CACHE_CONTROL, "no-store")],
                    Json(json!({
                        "access_token": api_key,
                        "token_type": "bearer",
                        "expires_in": 86400,
                        "scope": "write"
                    })),
                ).into_response(),
                None => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "invalid_grant"})),
                ).into_response(),
            }
        }
        "client_credentials" => {
            let secret = match form.client_secret {
                Some(s) if !s.is_empty() => s,
                _ => return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "invalid_client"})),
                ).into_response(),
            };
            (
                StatusCode::OK,
                [(header::CACHE_CONTROL, "no-store")],
                Json(json!({
                    "access_token": secret,
                    "token_type": "bearer",
                    "expires_in": 86400,
                    "scope": "write"
                })),
            ).into_response()
        }
        _ => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "unsupported_grant_type"})),
        ).into_response(),
    }
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    #[allow(dead_code)]
    client_name: Option<String>,
    #[allow(dead_code)]
    redirect_uris: Option<Vec<String>>,
}

pub async fn register(
    Json(_req): Json<RegisterRequest>,
) -> impl IntoResponse {
    (
        StatusCode::CREATED,
        Json(json!({
            "client_id": "yot",
            "client_secret": "unused",
            "token_endpoint_auth_method": "client_secret_post"
        })),
    )
}

fn generate_code() -> String {
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
