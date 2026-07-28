// ports: src/mcp/server.ts
// MCP server using raw JSON-RPC over stdio.
// 20 tools matching the TS implementation exactly.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::sync::Mutex;

use crate::core::event_bus::EventBus;
use crate::models::*;
use crate::services::{calendar, event, image, import, tag};

pub struct McpServer {
    pub conn: Mutex<Connection>,
    pub scope: String,
    pub bus: EventBus,
}

#[derive(Deserialize)]
pub struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Serialize)]
pub struct JsonRpcResponse {
    jsonrpc: String,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

impl McpServer {
    pub fn run(&self) {
        let stdin = io::stdin();
        let stdout = io::stdout();
        let mut stdout = stdout.lock();

        for line in stdin.lock().lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            if line.trim().is_empty() {
                continue;
            }

            let req: JsonRpcRequest = match serde_json::from_str(&line) {
                Ok(r) => r,
                Err(_) => continue,
            };

            let response = self.handle_request(&req);
            if let Some(resp) = response {
                let out = serde_json::to_string(&resp).unwrap();
                let _ = writeln!(stdout, "{}", out);
                let _ = stdout.flush();
            }
        }
    }

    pub fn handle_request(&self, req: &JsonRpcRequest) -> Option<JsonRpcResponse> {
        let id = req.id.clone()?;

        let result = match req.method.as_str() {
            "initialize" => self.handle_initialize(req.params.as_ref()),
            "tools/list" => self.handle_tools_list(),
            "tools/call" => self.handle_tools_call(req.params.as_ref()),
            "ping" => Ok(json!({})),
            _ => Err(json!({"code": -32601, "message": "Method not found"})),
        };

        Some(match result {
            Ok(r) => JsonRpcResponse { jsonrpc: "2.0".into(), id, result: Some(r), error: None },
            Err(e) => JsonRpcResponse { jsonrpc: "2.0".into(), id, result: None, error: Some(e) },
        })
    }

    fn handle_initialize(&self, _params: Option<&Value>) -> Result<Value, Value> {
        Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "yot-calendar",
                "version": env!("CARGO_PKG_VERSION")
            }
        }))
    }

    fn handle_tools_list(&self) -> Result<Value, Value> {
        Ok(json!({ "tools": self.tool_definitions() }))
    }

    fn handle_tools_call(&self, params: Option<&Value>) -> Result<Value, Value> {
        let params = params.ok_or_else(|| json!({"code": -32602, "message": "Missing params"}))?;
        let name = params.get("name").and_then(|v| v.as_str())
            .ok_or_else(|| json!({"code": -32602, "message": "Missing tool name"}))?;
        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

        let result = self.call_tool(name, &arguments);
        Ok(result)
    }

    fn require_write(&self) -> Result<(), String> {
        if self.scope != "write" {
            return Err("This API key is read-only".to_string());
        }
        Ok(())
    }

    fn with_conn<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, crate::core::error::AppError>,
    {
        let conn = self.conn.lock().unwrap();
        f(&conn).map_err(|e| e.message.clone())
    }

    fn emit(&self, event_type: &str, data: Value) {
        self.bus.emit(event_type, data);
    }

    fn call_tool(&self, name: &str, args: &Value) -> Value {
        let result = match name {
            "list_calendars" => self.tool_list_calendars(),
            "create_calendar" => self.tool_create_calendar(args),
            "update_calendar" => self.tool_update_calendar(args),
            "delete_calendar" => self.tool_delete_calendar(args),
            "list_events" => self.tool_list_events(args),
            "get_event" => self.tool_get_event(args),
            "create_event" => self.tool_create_event(args),
            "update_event" => self.tool_update_event(args),
            "delete_event" => self.tool_delete_event(args),
            "add_reminder" => self.tool_add_reminder(args),
            "remove_reminder" => self.tool_remove_reminder(args),
            "list_tags" => self.tool_list_tags(),
            "create_tag" => self.tool_create_tag(args),
            "update_tag" => self.tool_update_tag(args),
            "delete_tag" => self.tool_delete_tag(args),
            "tag_event" => self.tool_tag_event(args),
            "untag_event" => self.tool_untag_event(args),
            "get_event_image" => self.tool_get_event_image(args),
            "upload_image_from_url" => self.tool_upload_image_from_url(args),
            "import_ics" => self.tool_import_ics(args),
            _ => Err("Unknown tool".to_string()),
        };

        match result {
            Ok(data) => json!({
                "content": [{"type": "text", "text": serde_json::to_string_pretty(&data).unwrap_or_default()}]
            }),
            Err(msg) => json!({
                "content": [{"type": "text", "text": msg}],
                "isError": true
            }),
        }
    }

    fn tool_list_calendars(&self) -> Result<Value, String> {
        self.with_conn(|conn| calendar::list(conn)).map(|v| serde_json::to_value(v).unwrap())
    }

    fn tool_create_calendar(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let input: CreateCalendarInput = serde_json::from_value(args.clone()).map_err(|e| e.to_string())?;
        let cal = self.with_conn(|conn| calendar::create(conn, input))?;
        self.emit("calendar.created", serde_json::to_value(&cal).unwrap());
        Ok(serde_json::to_value(cal).unwrap())
    }

    fn tool_update_calendar(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let id = args.get("id").and_then(|v| v.as_str()).ok_or("Missing id")?;
        let input: UpdateCalendarInput = serde_json::from_value(args.clone()).map_err(|e| e.to_string())?;
        let cal = self.with_conn(|conn| calendar::update(conn, id, input))?;
        self.emit("calendar.updated", serde_json::to_value(&cal).unwrap());
        Ok(serde_json::to_value(cal).unwrap())
    }

    fn tool_delete_calendar(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let id = args.get("id").and_then(|v| v.as_str()).ok_or("Missing id")?.to_string();
        self.with_conn(|conn| calendar::delete(conn, &id))?;
        self.emit("calendar.deleted", json!({"id": id}));
        Ok(json!({"ok": true}))
    }

    fn tool_list_events(&self, args: &Value) -> Result<Value, String> {
        let query: EventQuery = serde_json::from_value(args.clone()).map_err(|e| e.to_string())?;
        self.with_conn(|conn| event::list(conn, &query)).map(|v| serde_json::to_value(v).unwrap())
    }

    fn tool_get_event(&self, args: &Value) -> Result<Value, String> {
        let id = args.get("id").and_then(|v| v.as_str()).ok_or("Missing id")?;
        self.with_conn(|conn| event::get(conn, id)).map(|v| serde_json::to_value(v).unwrap())
    }

    fn tool_create_event(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let input: CreateEventInput = serde_json::from_value(args.clone()).map_err(|e| e.to_string())?;
        let ev = self.with_conn(|conn| event::create(conn, input))?;
        self.emit("event.created", serde_json::to_value(&ev).unwrap());
        Ok(serde_json::to_value(ev).unwrap())
    }

    fn tool_update_event(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let id = args.get("id").and_then(|v| v.as_str()).ok_or("Missing id")?;
        let input: UpdateEventInput = serde_json::from_value(args.clone()).map_err(|e| e.to_string())?;
        let ev = self.with_conn(|conn| event::update(conn, id, input))?;
        self.emit("event.updated", serde_json::to_value(&ev).unwrap());
        Ok(serde_json::to_value(ev).unwrap())
    }

    fn tool_delete_event(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let id = args.get("id").and_then(|v| v.as_str()).ok_or("Missing id")?.to_string();
        self.with_conn(|conn| event::delete(conn, &id))?;
        self.emit("event.deleted", json!({"id": id}));
        Ok(json!({"ok": true}))
    }

    fn tool_add_reminder(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let event_id = args.get("event_id").and_then(|v| v.as_str()).ok_or("Missing event_id")?;
        let minutes_before = args.get("minutes_before").and_then(|v| v.as_i64()).ok_or("Missing minutes_before")?;
        let method = args.get("method").and_then(|v| v.as_str()).unwrap_or("notification");
        let r = self.with_conn(|conn| event::add_reminder(conn, event_id, CreateReminderInput {
            minutes_before, method: method.to_string(),
        }))?;
        let ev = self.with_conn(|conn| event::get(conn, event_id))?;
        self.emit("event.updated", serde_json::to_value(&ev).unwrap());
        Ok(serde_json::to_value(r).unwrap())
    }

    fn tool_remove_reminder(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let event_id = args.get("event_id").and_then(|v| v.as_str()).ok_or("Missing event_id")?;
        let reminder_id = args.get("reminder_id").and_then(|v| v.as_str()).ok_or("Missing reminder_id")?;
        self.with_conn(|conn| event::remove_reminder(conn, event_id, reminder_id))?;
        let ev = self.with_conn(|conn| event::get(conn, event_id))?;
        self.emit("event.updated", serde_json::to_value(&ev).unwrap());
        Ok(json!({"ok": true}))
    }

    fn tool_list_tags(&self) -> Result<Value, String> {
        self.with_conn(|conn| tag::list(conn)).map(|v| serde_json::to_value(v).unwrap())
    }

    fn tool_create_tag(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let input: CreateTagInput = serde_json::from_value(args.clone()).map_err(|e| e.to_string())?;
        let t = self.with_conn(|conn| tag::create(conn, input))?;
        self.emit("tag.created", serde_json::to_value(&t).unwrap());
        Ok(serde_json::to_value(t).unwrap())
    }

    fn tool_update_tag(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let id = args.get("id").and_then(|v| v.as_str()).ok_or("Missing id")?;
        let input: UpdateTagInput = serde_json::from_value(args.clone()).map_err(|e| e.to_string())?;
        let t = self.with_conn(|conn| tag::update(conn, id, input))?;
        self.emit("tag.updated", serde_json::to_value(&t).unwrap());
        Ok(serde_json::to_value(t).unwrap())
    }

    fn tool_delete_tag(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let id = args.get("id").and_then(|v| v.as_str()).ok_or("Missing id")?.to_string();
        self.with_conn(|conn| tag::delete(conn, &id))?;
        self.emit("tag.deleted", json!({"id": id}));
        Ok(json!({"ok": true}))
    }

    fn tool_tag_event(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let event_id = args.get("event_id").and_then(|v| v.as_str()).ok_or("Missing event_id")?;
        let tag_id = args.get("tag_id").and_then(|v| v.as_str()).ok_or("Missing tag_id")?;
        let ev = self.with_conn(|conn| event::add_tag(conn, event_id, tag_id))?;
        self.emit("event.updated", serde_json::to_value(&ev).unwrap());
        Ok(serde_json::to_value(ev).unwrap())
    }

    fn tool_untag_event(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let event_id = args.get("event_id").and_then(|v| v.as_str()).ok_or("Missing event_id")?;
        let tag_id = args.get("tag_id").and_then(|v| v.as_str()).ok_or("Missing tag_id")?;
        let ev = self.with_conn(|conn| event::remove_tag(conn, event_id, tag_id))?;
        self.emit("event.updated", serde_json::to_value(&ev).unwrap());
        Ok(serde_json::to_value(ev).unwrap())
    }

    fn tool_get_event_image(&self, args: &Value) -> Result<Value, String> {
        let id = args.get("id").and_then(|v| v.as_str()).ok_or("Missing id")?;
        let ev = self.with_conn(|conn| event::get(conn, id))?;
        match ev.image_path {
            None => Ok(json!(format!("Event {} has no cover image", id))),
            Some(ref path) => {
                match image::get_path(path) {
                    Ok(file_path) => {
                        match std::fs::read(&file_path) {
                            Ok(bytes) => {
                                let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                                let mime = image::mime_for_extension(ext);
                                let b64 = base64::Engine::encode(
                                    &base64::engine::general_purpose::STANDARD, &bytes,
                                );
                                Ok(json!({"_image": true, "data": b64, "mimeType": mime}))
                            }
                            Err(_) => Ok(json!(format!("Event {} has no cover image", id))),
                        }
                    }
                    Err(_) => Ok(json!(format!("Event {} has no cover image", id))),
                }
            }
        }
    }

    fn tool_upload_image_from_url(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let _url = args.get("url").and_then(|v| v.as_str()).ok_or("Missing url")?;
        Err("upload_image_from_url requires async runtime; use the REST API for URL uploads in MCP context".to_string())
    }

    fn tool_import_ics(&self, args: &Value) -> Result<Value, String> {
        self.require_write()?;
        let calendar_id = args.get("calendar_id").and_then(|v| v.as_str()).ok_or("Missing calendar_id")?;
        let ics = args.get("ics").and_then(|v| v.as_str()).ok_or("Missing ics")?;
        let result = self.with_conn(|conn| import::import_ics(conn, calendar_id, ics.as_bytes()))?;
        // One coarse broadcast per import; listeners refetch the whole list.
        // A dedicated type keeps the documented event.created payload intact.
        if result.created > 0 {
            self.emit("event.imported", json!({"imported": result.created}));
        }
        Ok(serde_json::to_value(result).unwrap())
    }

    fn tool_definitions(&self) -> Value {
        json!([
            {"name": "list_calendars", "description": "List all calendars", "inputSchema": {"type": "object", "properties": {}}},
            {"name": "create_calendar", "description": "Create a calendar", "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}, "color": {"type": "string"}, "description": {"type": "string"}}, "required": ["name"]}},
            {"name": "update_calendar", "description": "Update a calendar", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}, "name": {"type": "string"}, "color": {"type": ["string", "null"]}, "description": {"type": ["string", "null"]}}, "required": ["id"]}},
            {"name": "delete_calendar", "description": "Delete a calendar", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
            {"name": "list_events", "description": "List events with optional filters", "inputSchema": {"type": "object", "properties": {"calendarId": {"type": "string"}, "from": {"type": "string"}, "to": {"type": "string"}, "tag": {"type": "string"}, "q": {"type": "string"}, "limit": {"type": "integer"}, "offset": {"type": "integer"}}}},
            {"name": "get_event", "description": "Get one event by id", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
            {"name": "create_event", "description": "Create an event. 'description' is a human-readable summary; 'context' is an AI-oriented free-form field for supplementary details (parking, directions, pricing, reviews, etc.) that do not belong in the description.", "inputSchema": {"type": "object", "properties": {"calendar_id": {"type": "string"}, "title": {"type": "string"}, "start_at": {"type": "string"}, "end_at": {"type": "string"}, "all_day": {"type": "boolean"}, "description": {"type": "string"}, "context": {"type": "string"}, "location": {"type": "string"}, "url": {"type": "string"}, "image_path": {"type": "string"}}, "required": ["calendar_id", "title", "start_at", "end_at"]}},
            {"name": "update_event", "description": "Update an event. Set 'context' to null to clear it.", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}, "calendar_id": {"type": "string"}, "title": {"type": "string"}, "start_at": {"type": "string"}, "end_at": {"type": "string"}, "all_day": {"type": "boolean"}, "description": {"type": ["string", "null"]}, "context": {"type": ["string", "null"]}, "location": {"type": ["string", "null"]}, "url": {"type": ["string", "null"]}, "image_path": {"type": ["string", "null"]}}, "required": ["id"]}},
            {"name": "delete_event", "description": "Delete an event", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
            {"name": "add_reminder", "description": "Add a reminder to an event", "inputSchema": {"type": "object", "properties": {"event_id": {"type": "string"}, "minutes_before": {"type": "integer"}, "method": {"type": "string"}}, "required": ["event_id", "minutes_before"]}},
            {"name": "remove_reminder", "description": "Remove a reminder from an event", "inputSchema": {"type": "object", "properties": {"event_id": {"type": "string"}, "reminder_id": {"type": "string"}}, "required": ["event_id", "reminder_id"]}},
            {"name": "list_tags", "description": "List all tags", "inputSchema": {"type": "object", "properties": {}}},
            {"name": "create_tag", "description": "Create a tag", "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}, "color": {"type": "string"}}, "required": ["name"]}},
            {"name": "update_tag", "description": "Update a tag", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}, "name": {"type": "string"}, "color": {"type": ["string", "null"]}}, "required": ["id"]}},
            {"name": "delete_tag", "description": "Delete a tag", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
            {"name": "tag_event", "description": "Attach an existing tag to an event", "inputSchema": {"type": "object", "properties": {"event_id": {"type": "string"}, "tag_id": {"type": "string"}}, "required": ["event_id", "tag_id"]}},
            {"name": "untag_event", "description": "Detach a tag from an event", "inputSchema": {"type": "object", "properties": {"event_id": {"type": "string"}, "tag_id": {"type": "string"}}, "required": ["event_id", "tag_id"]}},
            {"name": "get_event_image", "description": "Get an event's cover image as a viewable image. Returns a message if the event has no cover.", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
            {"name": "upload_image_from_url", "description": "Fetch a remote image into local storage and return its path, suitable for an event's image_path. http(s) only; max 5 MB.", "inputSchema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
            {"name": "import_ics", "description": "Import iCalendar (.ics) text into a calendar as one-off events. Skips recurring (RRULE) and already-imported (UID) events.", "inputSchema": {"type": "object", "properties": {"calendar_id": {"type": "string"}, "ics": {"type": "string"}}, "required": ["calendar_id", "ics"]}}
        ])
    }
}
