use axum::{Router, Json, extract::Path};
use axum::routing::{get, post};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use crate::core::error::AppError;
use crate::rest::AppState;
use crate::services::image;
use serde::Deserialize;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/uploads/image", post(upload_image))
        .route("/uploads/image-from-url", post(upload_from_url))
        .route("/img/{file}", get(serve_image))
}

async fn upload_image(
    mut multipart: axum::extract::Multipart,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    while let Some(field) = multipart.next_field().await.map_err(|_| AppError::validation("Invalid multipart", None))? {
        if field.name() == Some("file") {
            let content_type = field.content_type()
                .unwrap_or("application/octet-stream")
                .to_string();
            let data = field.bytes().await
                .map_err(|_| AppError::validation("Failed to read file", None))?;
            let path = image::save_bytes(&data, &content_type)?;
            return Ok((StatusCode::CREATED, Json(serde_json::json!({"path": path}))));
        }
    }
    Err(AppError::validation("Missing file field", None))
}

#[derive(Deserialize)]
struct UrlInput {
    url: String,
}

async fn upload_from_url(
    Json(input): Json<UrlInput>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let path = image::download_from_url(&input.url).await?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({"path": path}))))
}

async fn serve_image(
    Path(file): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let path = image::get_path(&file)?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mime = image::mime_for_extension(ext);
    let data = std::fs::read(&path).map_err(|_| AppError::not_found("Not found"))?;

    Ok((
        StatusCode::OK,
        [
            (axum::http::header::CONTENT_TYPE, mime.to_string()),
            (axum::http::header::CACHE_CONTROL, "private, max-age=31536000, immutable".to_string()),
        ],
        data,
    ))
}
