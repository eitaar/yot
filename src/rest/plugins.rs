use axum::{Router, Json, extract::State, routing::get};
use serde_json::{json, Value};

use crate::core::error::AppError;
use crate::rest::AppState;

const DEFAULT_SPEC: &str = include_str!("../../static/plugins/tracking.json");

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/plugins", get(list_plugins))
        .route("/plugins/tracking", get(get_tracking_spec))
}

async fn list_plugins() -> Result<Json<Value>, AppError> {
    Ok(Json(json!({ "plugins": ["tracking-demo"] })))
}

async fn get_tracking_spec(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    let spec: Value = serde_json::from_str(DEFAULT_SPEC)
        .map_err(|e| AppError::internal(format!("invalid embedded spec: {e}")))?;
    Ok(Json(spec))
}
