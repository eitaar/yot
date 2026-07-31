use axum::{Router, extract::State, Json};
use axum::routing::get;
use serde::Serialize;
use crate::core::error::AppError;
use crate::rest::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/ask/models", get(list_models))
}

#[derive(Serialize)]
struct ModelsResponse {
    models: Vec<String>,
    default: String,
}

async fn list_models(
    State(state): State<AppState>,
) -> Result<Json<ModelsResponse>, AppError> {
    Ok(Json(ModelsResponse {
        models: state.config.hermes_allowed_models.clone(),
        default: state.config.hermes_default_model.clone(),
    }))
}
