use axum::{Router, Json, extract::{Path, Query, State}};
use axum::routing::{get, post, delete};
use axum::http::StatusCode;
use crate::core::error::AppError;
use crate::models::*;
use crate::rest::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/events", get(list_events).post(create_event))
        .route("/events/{id}", get(get_event).patch(update_event).delete(delete_event))
        .route("/events/{id}/reminders", post(add_reminder))
        .route("/events/{id}/reminders/{rid}", delete(remove_reminder))
        .route("/events/{id}/tags/{tagId}", post(add_tag).delete(remove_tag))
}

async fn list_events(
    State(state): State<AppState>,
    Query(query): Query<EventQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let events = state.db.call(move |conn| crate::services::event::list(conn, &query)).await?;
    Ok(Json(serde_json::to_value(events).unwrap()))
}

async fn get_event(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let event = state.db.call(move |conn| crate::services::event::get(conn, &id)).await?;
    Ok(Json(serde_json::to_value(event).unwrap()))
}

async fn create_event(
    State(state): State<AppState>,
    Json(input): Json<CreateEventInput>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let event = state.db.call(move |conn| crate::services::event::create(conn, input)).await?;
    state.bus.emit("event.created", serde_json::to_value(&event).unwrap());
    Ok((StatusCode::CREATED, Json(serde_json::to_value(event).unwrap())))
}

async fn update_event(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateEventInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let event = state.db.call(move |conn| crate::services::event::update(conn, &id, input)).await?;
    state.bus.emit("event.updated", serde_json::to_value(&event).unwrap());
    Ok(Json(serde_json::to_value(event).unwrap()))
}

async fn delete_event(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let deleted_id = id.clone();
    state.db.call(move |conn| crate::services::event::delete(conn, &id)).await?;
    state.bus.emit("event.deleted", serde_json::json!({"id": deleted_id}));
    Ok(StatusCode::NO_CONTENT)
}

async fn add_reminder(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreateReminderInput>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let event_id = id.clone();
    let reminder = state.db.call(move |conn| crate::services::event::add_reminder(conn, &id, input)).await?;
    let event = state.db.call(move |conn| crate::services::event::get(conn, &event_id)).await?;
    state.bus.emit("event.updated", serde_json::to_value(&event).unwrap());
    Ok((StatusCode::CREATED, Json(serde_json::to_value(reminder).unwrap())))
}

async fn remove_reminder(
    State(state): State<AppState>,
    Path((id, rid)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let event_id = id.clone();
    state.db.call(move |conn| crate::services::event::remove_reminder(conn, &id, &rid)).await?;
    let event = state.db.call(move |conn| crate::services::event::get(conn, &event_id)).await?;
    state.bus.emit("event.updated", serde_json::to_value(&event).unwrap());
    Ok(StatusCode::NO_CONTENT)
}

async fn add_tag(
    State(state): State<AppState>,
    Path((id, tag_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let event = state.db.call(move |conn| crate::services::event::add_tag(conn, &id, &tag_id)).await?;
    state.bus.emit("event.updated", serde_json::to_value(&event).unwrap());
    Ok(Json(serde_json::to_value(event).unwrap()))
}

async fn remove_tag(
    State(state): State<AppState>,
    Path((id, tag_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let event = state.db.call(move |conn| crate::services::event::remove_tag(conn, &id, &tag_id)).await?;
    state.bus.emit("event.updated", serde_json::to_value(&event).unwrap());
    Ok(Json(serde_json::to_value(event).unwrap()))
}
