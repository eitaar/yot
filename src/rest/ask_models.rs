use axum::{Router, extract::State, Json};
use axum::routing::get;
use serde::Serialize;
use serde_json::Value;
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
    let models = if !state.config.hermes_allowed_models.is_empty() {
        state.config.hermes_allowed_models.clone()
    } else {
        discover_models(&state).await.unwrap_or_default()
    };

    Ok(Json(ModelsResponse {
        models,
        default: state.config.hermes_default_model.clone(),
    }))
}

async fn discover_models(state: &AppState) -> Result<Vec<String>, AppError> {
    let models_url = state
        .config
        .hermes_api_url
        .strip_suffix("/v1/chat/completions")
        .unwrap_or(&state.config.hermes_api_url)
        .to_string() + "/v1/models";

    let api_key = state.config.hermes_api_key.as_ref()
        .ok_or_else(|| AppError::internal("Hermes API key not configured"))?;

    let response = state.http_client
        .get(models_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| AppError::internal(format!("Hermes models request failed: {e}")))?;

    if !response.status().is_success() {
        return Err(AppError::internal(format!("Hermes models API returned {}", response.status())));
    }

    let payload: Value = response.json().await
        .map_err(|e| AppError::internal(format!("Failed to parse Hermes models response: {e}")))?;

    Ok(payload.get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect())
}
