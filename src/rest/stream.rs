use axum::{Router, extract::State, response::IntoResponse};
use axum::routing::get;
use futures::stream::{self, StreamExt};
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::wrappers::IntervalStream;
use crate::rest::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/stream", get(sse_handler))
}

async fn sse_handler(State(state): State<AppState>) -> impl IntoResponse {
    let rx = state.bus.subscribe();

    let padding = format!(": {}\n\n", " ".repeat(2048));
    let ready = "event: ready\ndata: connected\n\n".to_string();

    let ping_interval = IntervalStream::new(tokio::time::interval(Duration::from_secs(25)));
    let ping_stream = ping_interval.map(|_| {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        Ok::<_, Infallible>(format!("event: ping\ndata: {}\n\n", ms))
    });

    let bus_stream = tokio_stream::wrappers::BroadcastStream::new(rx)
        .filter_map(|result| async {
            match result {
                Ok(event) => {
                    let data = serde_json::to_string(&event.data).unwrap_or_default();
                    Some(Ok::<_, Infallible>(format!("event: {}\ndata: {}\n\n", event.event_type, data)))
                }
                Err(_) => None,
            }
        });

    let initial = stream::once(async move {
        Ok::<_, Infallible>(format!("{}{}", padding, ready))
    });

    let body_stream = initial.chain(stream::select(ping_stream, bus_stream));

    let body = axum::body::Body::from_stream(body_stream);

    (
        [
            (axum::http::header::CONTENT_TYPE, "text/event-stream"),
            (axum::http::header::CACHE_CONTROL, "no-cache, no-transform"),
            (axum::http::header::HeaderName::from_static("x-accel-buffering"), "no"),
        ],
        body,
    )
}
