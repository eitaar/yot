use std::{collections::VecDeque, convert::Infallible, pin::Pin};

use axum::{
    Router,
    body::{Body, Bytes},
    extract::State,
    http::{StatusCode, header},
    response::Response,
};
use axum::routing::post;
use futures::{Stream, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::core::error::AppError;
use crate::rest::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/ask", post(ask))
}

#[derive(Deserialize)]
struct AskInput {
    query: String,
    context: Option<String>,
    model: Option<String>,
}

const SYSTEM_PROMPT: &str = "You are a calendar assistant for yot. Before answering, consult and follow any relevant yot calendar skills and tools. Use the available yot MCP tools for calendar data. Be concise and answer in the user's language.";

type UpstreamStream = Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;

struct ProxyState {
    upstream: UpstreamStream,
    buffer: Vec<u8>,
    pending: VecDeque<Bytes>,
    model: String,
    usage: Option<Value>,
    upstream_finished: bool,
    final_queued: bool,
}

async fn ask(
    State(state): State<AppState>,
    axum::Json(input): axum::Json<AskInput>,
) -> Result<Response, AppError> {
    let api_key = state.config.hermes_api_key.as_ref()
        .ok_or_else(|| AppError::internal("Hermes API key not configured"))?;

    let mut messages = vec![json!({"role": "system", "content": SYSTEM_PROMPT})];
    if let Some(ref ctx) = input.context {
        messages.push(json!({"role": "system", "content": ctx}));
    }
    messages.push(json!({"role": "user", "content": input.query}));

    let model = input.model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| state.config.hermes_default_model.clone());

    if !state.config.hermes_allowed_models.is_empty()
        && !state.config.hermes_allowed_models.contains(&model)
    {
        return Err(AppError::validation(
            format!("Model '{}' is not in the allowed list", model),
            None,
        ));
    }

    let body = json!({"model": model, "messages": messages, "stream": true});
    let session_key = format!("yot-{}", uuid::Uuid::new_v4());
    let resp = state.http_client
        .post(&state.config.hermes_api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("X-Hermes-Session-Key", &session_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::internal(format!("Hermes request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("Hermes API error: {status} {text}");
        return Err(AppError::internal(format!("Hermes API returned {status}")));
    }

    let stream = proxy_stream(ProxyState {
        upstream: Box::pin(resp.bytes_stream()),
        buffer: Vec::new(),
        pending: VecDeque::new(),
        model,
        usage: None,
        upstream_finished: false,
        final_queued: false,
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(stream))
        .map_err(|e| AppError::internal(format!("Failed to create stream response: {e}")))
}

fn sse_data(value: Value) -> Bytes {
    Bytes::from(format!("data: {}\n\n", value))
}

fn process_line(state: &mut ProxyState, line: &[u8]) {
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    let Some(data) = line.strip_prefix(b"data:") else { return };
    let data = data.strip_prefix(b" ").unwrap_or(data);
    if data == b"[DONE]" {
        state.upstream_finished = true;
        return;
    }

    let chunk: Value = match serde_json::from_slice(data) {
        Ok(value) => value,
        Err(error) => {
            state.pending.push_back(sse_data(json!({
                "type": "error", "error": format!("Invalid Hermes SSE data: {error}")
            })));
            state.upstream_finished = true;
            return;
        }
    };

    if let Some(value) = chunk.get("model").and_then(Value::as_str) {
        state.model = value.to_string();
    }
    if let Some(usage) = chunk.get("usage") {
        state.usage = Some(usage.clone());
    }
    if let Some(text) = chunk.get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("content"))
        .and_then(Value::as_str)
        && !text.is_empty()
    {
        state.pending.push_back(sse_data(json!({
            "type": "delta", "text": text
        })));
    }
}

fn proxy_stream(state: ProxyState) -> impl Stream<Item = Result<Bytes, Infallible>> {
    futures::stream::unfold(state, |mut state| async move {
        loop {
            if let Some(event) = state.pending.pop_front() {
                return Some((Ok(event), state));
            }
            if state.upstream_finished {
                if !state.final_queued {
                    state.final_queued = true;
                    let event = sse_data(json!({
                        "type": "done", "model": state.model, "usage": state.usage
                    }));
                    return Some((Ok(event), state));
                }
                return None;
            }

            match state.upstream.next().await {
                Some(Ok(bytes)) => {
                    state.buffer.extend_from_slice(&bytes);
                    while let Some(index) = state.buffer.iter().position(|byte| *byte == b'\n') {
                        let line: Vec<u8> = state.buffer.drain(..=index).collect();
                        process_line(&mut state, &line[..line.len() - 1]);
                    }
                }
                Some(Err(error)) => {
                    state.pending.push_back(sse_data(json!({
                        "type": "error", "error": format!("Hermes stream failed: {error}")
                    })));
                    state.upstream_finished = true;
                }
                None => {
                    if !state.buffer.is_empty() {
                        let line = std::mem::take(&mut state.buffer);
                        process_line(&mut state, &line);
                    }
                    state.upstream_finished = true;
                }
            }
        }
    })
}
