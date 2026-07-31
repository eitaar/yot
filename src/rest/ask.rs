use axum::{Router, extract::State, Json};
use axum::routing::post;
use serde::{Deserialize, Serialize};
use serde_json::json;
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

#[derive(Serialize)]
struct AskResponse {
    answer: String,
    model: String,
    usage: Option<serde_json::Value>,
}

const SYSTEM_PROMPT: &str = "You are a calendar assistant for yot. Use the available yot MCP tools to answer questions about the user's calendar. Be concise and answer in the user's language.";

async fn ask(
    State(state): State<AppState>,
    Json(input): Json<AskInput>,
) -> Result<Json<AskResponse>, AppError> {
    let api_key = state.config.hermes_api_key.as_ref()
        .ok_or_else(|| AppError::internal("Hermes API key not configured"))?;

    let mut messages = vec![
        json!({"role": "system", "content": SYSTEM_PROMPT}),
    ];

    if let Some(ref ctx) = input.context {
        messages.push(json!({"role": "system", "content": ctx}));
    }

    messages.push(json!({"role": "user", "content": input.query}));

    let model = input.model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| state.config.hermes_default_model.clone());

    let body = json!({
        "model": model,
        "messages": messages,
        "stream": false,
    });

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

    let resp_json: serde_json::Value = resp.json().await
        .map_err(|e| AppError::internal(format!("Failed to parse Hermes response: {e}")))?;

    let answer = resp_json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    let model = resp_json
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("hermes-agent")
        .to_string();

    let usage = resp_json.get("usage").cloned();

    Ok(Json(AskResponse { answer, model, usage }))
}