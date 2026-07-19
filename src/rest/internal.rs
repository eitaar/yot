use axum::{Router, Json, extract::State};
use axum::routing::post;
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::Value;
use crate::core::error::AppError;
use crate::rest::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/internal/events", post(relay_event))
}

#[derive(Deserialize)]
struct RelayInput {
    #[serde(rename = "type")]
    event_type: String,
    data: Value,
}

async fn relay_event(
    State(state): State<AppState>,
    Json(input): Json<RelayInput>,
) -> Result<StatusCode, AppError> {
    let re = regex_lite::Regex::new(r"^[a-z]+\.[a-z]+$").unwrap();
    if !re.is_match(&input.event_type) {
        return Err(AppError::validation("Invalid event type", None));
    }
    state.bus.emit(input.event_type, input.data);
    Ok(StatusCode::NO_CONTENT)
}
