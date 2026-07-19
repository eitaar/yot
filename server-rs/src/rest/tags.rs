use axum::{Router, Json, extract::{Path, State}};
use axum::routing::get;
use axum::http::StatusCode;
use crate::core::error::AppError;
use crate::models::{CreateTagInput, UpdateTagInput};
use crate::rest::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/tags", get(list_tags).post(create_tag))
        .route("/tags/{id}", axum::routing::patch(update_tag).delete(delete_tag))
}

async fn list_tags(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let tags = state.db.call(|conn| crate::services::tag::list(conn)).await?;
    Ok(Json(serde_json::to_value(tags).unwrap()))
}

async fn create_tag(
    State(state): State<AppState>,
    Json(input): Json<CreateTagInput>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let tag = state.db.call(move |conn| crate::services::tag::create(conn, input)).await?;
    state.bus.emit("tag.created", serde_json::to_value(&tag).unwrap());
    Ok((StatusCode::CREATED, Json(serde_json::to_value(tag).unwrap())))
}

async fn update_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateTagInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tag = state.db.call(move |conn| crate::services::tag::update(conn, &id, input)).await?;
    state.bus.emit("tag.updated", serde_json::to_value(&tag).unwrap());
    Ok(Json(serde_json::to_value(tag).unwrap()))
}

async fn delete_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let deleted_id = id.clone();
    state.db.call(move |conn| crate::services::tag::delete(conn, &id)).await?;
    state.bus.emit("tag.deleted", serde_json::json!({"id": deleted_id}));
    Ok(StatusCode::NO_CONTENT)
}
