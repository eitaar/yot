use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

use super::AppState;
use crate::mcp::server::JsonRpcRequest;

pub async fn handle_mcp(
    State(state): State<AppState>,
    Json(req): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    let mcp = state.mcp.clone();
    let result = tokio::task::spawn_blocking(move || {
        mcp.handle_request(&req)
    })
    .await;

    match result {
        Ok(Some(resp)) => Json(resp).into_response(),
        Ok(None) => StatusCode::ACCEPTED.into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32603, "message": "Internal error"}})),
        ).into_response(),
    }
}
