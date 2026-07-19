pub mod auth;
pub mod calendars;
pub mod events;
pub mod import;
pub mod internal;
pub mod stream;
pub mod tags;
pub mod uploads;

use std::sync::Arc;
use axum::{Router, middleware};
use axum::extract::Request;
use axum::response::{IntoResponse, Response};
use axum::http::{StatusCode, header};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use rust_embed::Embed;
use crate::auth::middleware::auth_middleware;
use crate::auth::pairing::PairingService;
use crate::auth::rate_limit::RateLimiter;
use crate::core::event_bus::EventBus;
use crate::db::Db;

#[derive(Embed)]
#[folder = "web/dist/"]
#[prefix = ""]
struct WebAssets;

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub bus: EventBus,
    pub pairing: Arc<PairingService>,
    pub rate_limiter: Arc<RateLimiter>,
}

pub fn build_router(state: AppState) -> Router {
    let public_routes = Router::new()
        .merge(auth::public_routes())
        .merge(meta_routes());

    let protected_routes = Router::new()
        .merge(calendars::routes())
        .merge(events::routes())
        .merge(tags::routes())
        .merge(uploads::routes())
        .merge(import::routes())
        .merge(stream::routes())
        .merge(internal::routes())
        .merge(auth::protected_routes())
        .layer(middleware::from_fn({
            let db = state.db.clone();
            move |req, next| {
                let db = db.clone();
                auth_middleware(db, req, next)
            }
        }));

    let api = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .with_state(state.clone());

    Router::new()
        .nest("/api", api)
        .fallback(serve_embedded_spa)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}

async fn serve_embedded_spa(req: Request) -> Response {
    let path = req.uri().path().trim_start_matches('/');

    if let Some(file) = WebAssets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        (
            StatusCode::OK,
            [(header::CONTENT_TYPE, mime.as_ref())],
            file.data,
        ).into_response()
    } else if let Some(index) = WebAssets::get("index.html") {
        (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html")],
            index.data,
        ).into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

fn meta_routes() -> Router<AppState> {
    use axum::routing::get;
    use axum::Json;
    use serde_json::json;

    Router::new()
        .route("/health", get(|| async { Json(json!({"status": "ok"})) }))
        .route("/doc", get(serve_openapi_doc))
        .route("/ui", get(serve_swagger_ui))
}

async fn serve_openapi_doc() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/json")],
        include_str!("../../static/openapi.json"),
    )
}

async fn serve_swagger_ui() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/html")],
        include_str!("../../static/swagger.html"),
    )
}
