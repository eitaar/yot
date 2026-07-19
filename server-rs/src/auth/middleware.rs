// ports: src/auth/middleware.ts
use axum::extract::Request;
use axum::http::{Method, HeaderMap};
use axum::middleware::Next;
use axum::response::Response;
use crate::core::error::AppError;
use crate::db::Db;
use crate::models::ApiKey;

#[derive(Clone)]
pub struct AuthContext {
    pub key: ApiKey,
}

pub fn extract_raw_key(headers: &HeaderMap, query: Option<&str>, cookie_header: Option<&str>) -> Option<String> {
    if let Some(auth) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        let trimmed = auth.trim();
        if let Some(bearer) = trimmed.strip_prefix("Bearer ") {
            return Some(bearer.trim().to_string());
        }
        return Some(trimmed.to_string());
    }

    if let Some(key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return Some(key.trim().to_string());
    }

    if let Some(cookies) = cookie_header {
        for part in cookies.split(';') {
            let part = part.trim();
            if let Some(value) = part.strip_prefix("yot_session=") {
                return Some(value.to_string());
            }
        }
    }

    if let Some(key_param) = query {
        return Some(key_param.to_string());
    }

    None
}

pub async fn auth_middleware(
    db: Db,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let headers = req.headers().clone();
    let uri = req.uri().clone();

    let query_key = uri.query().and_then(|q| {
        url::form_urlencoded::parse(q.as_bytes())
            .find(|(k, _)| k == "key")
            .map(|(_, v)| v.to_string())
    });

    let cookie_header = headers.get("cookie").and_then(|v| v.to_str().ok()).map(|s| s.to_string());

    let raw_key = extract_raw_key(&headers, query_key.as_deref(), cookie_header.as_deref())
        .ok_or_else(|| AppError::unauthorized("Unauthorized"))?;

    let api_key = db.call(move |conn| {
        crate::auth::apikey::authenticate(conn, &raw_key)
    }).await?;

    let method = req.method().clone();
    if api_key.scope == "read" && !matches!(method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return Err(AppError::forbidden("Forbidden"));
    }

    req.extensions_mut().insert(AuthContext { key: api_key });
    Ok(next.run(req).await)
}
