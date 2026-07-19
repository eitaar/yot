use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

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
        "token_endpoint": format!("{base}/oauth/token"),
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
        "grant_types_supported": ["client_credentials"],
        "response_types_supported": ["token"],
        "scopes_supported": ["read", "write"]
    }))
}

#[derive(Deserialize)]
pub struct TokenRequest {
    grant_type: String,
    #[allow(dead_code)]
    client_id: Option<String>,
    client_secret: Option<String>,
}

pub async fn token(
    axum::Form(form): axum::Form<TokenRequest>,
) -> impl IntoResponse {
    if form.grant_type != "client_credentials" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "unsupported_grant_type"})),
        ).into_response();
    }

    let secret = match form.client_secret {
        Some(s) if !s.is_empty() => s,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "invalid_client", "error_description": "client_secret is required"})),
            ).into_response();
        }
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
