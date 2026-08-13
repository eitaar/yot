use axum::{Router, Json, extract::State, routing::get};
use serde_json::{json, Value};

use crate::core::error::AppError;
use crate::rest::AppState;

const DEFAULT_SPEC: &str = include_str!("../../static/plugins/tracking.json");
const F1_SPEC: &str = include_str!("../../static/plugins/f1-2026.json");

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/plugins", get(list_plugins))
        .route("/plugins/tracking", get(get_tracking_spec))
        .route("/plugins/f1-2026", get(get_f1_spec))
}

async fn list_plugins() -> Result<Json<Value>, AppError> {
    Ok(Json(json!({ "plugins": ["tracking-demo", "f1-2026"] })))
}

async fn get_tracking_spec(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(parse_spec(DEFAULT_SPEC)?))
}

async fn get_f1_spec(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(parse_spec(F1_SPEC)?))
}

fn parse_spec(raw: &str) -> Result<Value, AppError> {
    serde_json::from_str(raw).map_err(|e| AppError::internal(format!("invalid embedded spec: {e}")))
}
