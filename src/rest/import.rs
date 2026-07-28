use axum::{Router, Json, extract::State};
use axum::routing::post;
use axum::http::StatusCode;
use crate::core::error::AppError;
use crate::rest::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/events/import", post(import_ics))
}

async fn import_ics(
    State(state): State<AppState>,
    mut multipart: axum::extract::Multipart,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut calendar_id: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|_| AppError::validation("Invalid multipart", None))? {
        match field.name() {
            Some("file") => {
                file_data = Some(
                    field.bytes().await
                        .map_err(|_| AppError::validation("Failed to read file", None))?
                        .to_vec()
                );
            }
            Some("calendar_id") => {
                calendar_id = Some(
                    field.text().await
                        .map_err(|_| AppError::validation("Failed to read calendar_id", None))?
                );
            }
            _ => {}
        }
    }

    let data = file_data.ok_or_else(|| AppError::validation("Missing file field", None))?;
    let cal_id = calendar_id.ok_or_else(|| AppError::validation("Missing calendar_id field", None))?;

    let result = state.db.call(move |conn| {
        crate::services::import::import_ics(conn, &cal_id, &data)
    }).await?;

    // One coarse broadcast per import: listeners refetch the whole event list,
    // so per-event emits would only flood the bus on large files.
    if result.created > 0 {
        state.bus.emit("event.created", serde_json::json!({"imported": result.created}));
    }

    Ok((StatusCode::OK, Json(serde_json::to_value(result).unwrap())))
}
