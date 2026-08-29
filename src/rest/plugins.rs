use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::core::error::AppError;
use crate::rest::AppState;
use crate::services::plugin_source::SourceSpec;

/// Metadata shown in the plugin list. The full spec carries `data`, `derive`,
/// `listRow`, etc. on top of these fields; serde ignores the extras here.
#[derive(Deserialize)]
struct PluginMeta {
    id: String,
    title: String,
    description: String,
    version: u64,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/plugins", get(list_plugins))
        .route("/plugins/{id}", get(get_plugin))
}

/// `GET /api/plugins` — scan `~/.yot/plugins/*.json` and return metadata for
/// each valid plugin. A missing directory is treated as an empty list; an
/// unparseable file is skipped with a warning.
async fn list_plugins(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let dir = state.config.plugin_dir.clone();
    let mut plugins = Vec::new();

    match std::fs::read_dir(&dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(raw) = std::fs::read_to_string(&path) {
                    match serde_json::from_str::<PluginMeta>(&raw) {
                        Ok(meta) => plugins.push(json!({
                            "id": meta.id,
                            "title": meta.title,
                            "description": meta.description,
                            "version": meta.version,
                        })),
                        Err(e) => {
                            tracing::warn!("skipping invalid plugin {}: {e}", path.display());
                        }
                    }
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // No plugin directory yet — that's fine.
        }
        Err(e) => {
            tracing::warn!("failed to read plugin dir {}: {e}", dir.display());
        }
    }

    Ok(Json(json!({ "plugins": plugins })))
}

/// `GET /api/plugins/{id}` — return the full spec for one plugin from
/// `~/.yot/plugins/{id}.json`. The id is guarded against path traversal.
///
/// If the spec carries a valid `source` block, the bound calendar's events
/// are merged into `data.items` (server-side). An invalid `source` falls
/// back to serving the static items unchanged.
async fn get_plugin(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err(AppError::not_found(format!("plugin not found: {id}")));
    }

    let path = state.config.plugin_dir.join(format!("{id}.json"));
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| AppError::not_found(format!("plugin not found: {id}")))?;
    let spec: Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::internal(format!("invalid plugin spec: {e}")))?;

    let spec = match spec.get("source") {
        Some(src_val) if !src_val.is_null() => match SourceSpec::from_value(src_val) {
            Ok(src) => {
                match state
                    .db
                    .call(move |conn| crate::services::plugin_source::merge_items(conn, &src))
                    .await
                {
                    Ok(merged) => {
                        let mut spec = spec;
                        if let Some(obj) = spec.as_object_mut() {
                            match obj.get_mut("data").and_then(|d| d.as_object_mut()) {
                                Some(data) => {
                                    data.insert("items".into(), Value::Array(merged));
                                }
                                None => {
                                    obj.insert("data".into(), json!({ "items": [], "franchises": [] }));
                                }
                            }
                        }
                        spec
                    }
                    Err(e) => {
                        tracing::warn!("plugin {id}: source merge failed, serving static items: {e}");
                        spec
                    }
                }
            }
            Err(e) => {
                tracing::warn!("plugin {id}: invalid source, serving static items: {e}");
                spec
            }
        },
        _ => spec,
    };

    Ok(Json(spec))
}
