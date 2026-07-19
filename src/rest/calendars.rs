use axum::{Router, Json, extract::{Path, State}};
use axum::routing::get;
use axum::http::StatusCode;
use crate::core::error::AppError;
use crate::models::{CreateCalendarInput, UpdateCalendarInput};
use crate::rest::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/calendars", get(list_calendars).post(create_calendar))
        .route("/calendars/{id}", get(get_calendar).patch(update_calendar).delete(delete_calendar))
}

async fn list_calendars(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let calendars = state.db.call(|conn| crate::services::calendar::list(conn)).await?;
    Ok(Json(serde_json::to_value(calendars).unwrap()))
}

async fn get_calendar(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cal = state.db.call(move |conn| crate::services::calendar::get(conn, &id)).await?;
    Ok(Json(serde_json::to_value(cal).unwrap()))
}

async fn create_calendar(
    State(state): State<AppState>,
    Json(input): Json<CreateCalendarInput>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let cal = state.db.call(move |conn| crate::services::calendar::create(conn, input)).await?;
    state.bus.emit("calendar.created", serde_json::to_value(&cal).unwrap());
    Ok((StatusCode::CREATED, Json(serde_json::to_value(cal).unwrap())))
}

async fn update_calendar(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateCalendarInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cal = state.db.call(move |conn| crate::services::calendar::update(conn, &id, input)).await?;
    state.bus.emit("calendar.updated", serde_json::to_value(&cal).unwrap());
    Ok(Json(serde_json::to_value(cal).unwrap()))
}

async fn delete_calendar(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let deleted_id = id.clone();
    state.db.call(move |conn| crate::services::calendar::delete(conn, &id)).await?;
    state.bus.emit("calendar.deleted", serde_json::json!({"id": deleted_id}));
    Ok(StatusCode::NO_CONTENT)
}
