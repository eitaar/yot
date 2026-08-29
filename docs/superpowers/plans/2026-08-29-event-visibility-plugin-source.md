# Event Visibility + Plugin Source Binding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `visible` flag to events (agent API only) and bind the Flights plugin to a calendar as its data source via server-side merge — zero client changes.

**Architecture:** `events.visible` column (add_column_if_missing pattern) + default-filtered `list` with `includeHidden` escape hatch. SSE broadcasts suppressed for hidden events. `GET /api/plugins/{id}` merges events from a spec-declared calendar into plugin items (Rust-side mapping), replacing static `data.items`.

**Tech Stack:** Rust / axum / rusqlite / serde_json. Tests: in-memory SQLite (`tests/services_test.rs` pattern) + router harness (`tests/sse_emit_test.rs` pattern).

**Spec:** `docs/superpowers/specs/2026-08-29-event-visibility-plugin-source-design.md` (commit `61fb41f`)

**Environment facts (verified):**
- Server runs as systemd user unit `yot-server.service`, binary at `~/.yot/yot-server`, port 4010, `YOT_DATA_DIR=~/.yot`.
- Deploy: `cargo build --release` + `cp` over the binary + `systemctl --user restart yot-server`. The old binary keeps running from deleted inode during overwrite — safe.
- Repo: `~/projects/yot-server`, branch off `origin/main` (PR #39 already merged; current `feat/plugins-endpoint` local HEAD is behind main).
- There is an untracked design doc on the current branch — commit it on the new branch first.
- Existing test layout: `tests/services_test.rs` (service layer, `setup()` opens in-memory conn + initializes schema), `tests/sse_emit_test.rs` (router + bus harness). Unit tests also live inline (`src/core/time.rs`).
- `EventQuery` struct literals exist in tests and use full-field syntax — adding a field requires updating those literals (they do NOT use `..Default`).

---

### Task 1: Branch + `visible` column in schema

**Files:**
- Modify: `src/db/schema.rs:75` (add after the `context` line)

- [ ] **Step 1: Create the working branch off origin/main**

```bash
cd ~/projects/yot-server
git stash list | grep -q . || true
git fetch origin
git checkout -b feat/event-visibility-plugin-source origin/main
# Bring the design doc along (it sits untracked on the old branch):
git checkout feat/plugins-endpoint -- docs/superpowers/specs/2026-08-29-event-visibility-plugin-source-design.md 2>/dev/null || true
git add docs/superpowers/specs/2026-08-29-event-visibility-plugin-source-design.md
git commit -m "docs: design spec for event visibility + plugin source binding"
```

- [ ] **Step 2: Write the failing test**

Add to `tests/services_test.rs` (same file, after existing imports — the file already has `setup()` opening an in-memory conn and initializing schema):

```rust
#[test]
fn visible_flag_survives_create_and_update() {
    let conn = setup();
    let cal = calendar::create(&conn, CreateCalendarInput { name: "c".into(), color: None, description: None }).unwrap();

    // Default is visible.
    let ev = event::create(&conn, CreateEventInput {
        calendar_id: cal.id.clone(),
        title: "flight".into(),
        start_at: "2026-09-01T00:00:00.000Z".into(),
        end_at: "2026-09-01T01:00:00.000Z".into(),
        all_day: false,
        description: None, context: None, location: None, url: None, image_path: None,
        visible: Some(false),
    }).unwrap();
    assert!(!ev.visible);

    // Explicit visible=true.
    let ev2 = event::create(&conn, CreateEventInput {
        calendar_id: cal.id.clone(),
        title: "personal".into(),
        start_at: "2026-09-02T00:00:00.000Z".into(),
        end_at: "2026-09-02T01:00:00.000Z".into(),
        all_day: false,
        description: None, context: None, location: None, url: None, image_path: None,
        visible: Some(true),
    }).unwrap();
    assert!(ev2.visible);

    // Toggle to hidden via update.
    let ev3 = event::update(&conn, &ev2.id, UpdateEventInput {
        visible: Some(false),
        calendar_id: None, title: None, start_at: None, end_at: None, all_day: None,
        description: None, context: None, location: None, url: None, image_path: None,
    }).unwrap();
    assert!(!ev3.visible);
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --test services_test visible_flag 2>&1 | tail -5`
Expected: FAIL — compile error "no field `visible`" on `CreateEventInput` / `UpdateEventInput` (struct literals in existing tests also break — fix them in Task 2 Step 3 if the compiler points there first; the new field is `#[serde(default)]` so JSON callers are unaffected).

- [ ] **Step 4: Implement — schema + models**

`src/db/schema.rs` — extend the existing migration block (line ~75):

```rust
    add_column_if_missing(conn, "events", "image_path", "TEXT")?;
    add_column_if_missing(conn, "events", "url", "TEXT")?;
    add_column_if_missing(conn, "events", "source_uid", "TEXT")?;
    add_column_if_missing(conn, "events", "context", "TEXT")?;
    add_column_if_missing(conn, "events", "visible", "INTEGER NOT NULL DEFAULT 1")?;
```

Note: `add_column_if_missing` executes `ALTER TABLE ... ADD COLUMN <name> <col_type>` verbatim, so passing the full `INTEGER NOT NULL DEFAULT 1` type string works as-is. SQLite populates existing rows with the default.

`src/models.rs`:

```rust
// CreateEventInput — add:
    #[serde(default = "default_visible")]
    pub visible: Option<bool>,

// Actually cleaner: keep Create symmetric with the rest of the struct:
    #[serde(default)]
    pub visible: Option<bool>,

// UpdateEventInput — add:
    pub visible: Option<bool>,

// Event struct — add after source_uid:
    pub visible: bool,

// Helper next to the other defaults:
fn default_visible() -> Option<bool> {
    None
}
```

(Use the plain `#[serde(default)] pub visible: Option<bool>` form — `None` = server default. No `default_visible` fn needed.)

- [ ] **Step 5: Implement — service layer**

`src/services/event.rs`:

1. Both SELECT column lists (`list` line ~11 and `get` line ~99): append `, e.visible` / `, visible` and read it in both row mappers as `visible: row.get::<_, i64>(N)? != 0` with the index shifted to match (it goes after `source_uid`, so `list` index 14→ wait: columns are id(0)…created_at(12), updated_at(13) — append visible at index 14 in `list`, index 14 in `get` too since `get` selects `id, calendar_id, title, description, context, location, start_at, end_at, all_day, image_path, url, source_uid, created_at, updated_at` (14 cols, visible → 14)). Add `visible: bool` to `struct EventRow` and `into_event`.
2. `create()` INSERT — add column + param:

```rust
        "INSERT INTO events (id, calendar_id, title, description, context, location, start_at, end_at, \
         all_day, image_path, url, visible, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            input.calendar_id,
            input.title,
            input.description,
            input.context,
            input.location,
            input.start_at,
            input.end_at,
            input.all_day as i64,
            input.image_path,
            input.url,
            input.visible.unwrap_or(true) as i64,
            now,
            now,
        ],
```

3. `update()` — resolve + write:

```rust
    let visible = input.visible.unwrap_or(existing.visible);
    // add `visible=?` to the SET clause and `visible` to params before now/id
```

4. `EventQuery` handling comes in Task 2.

- [ ] **Step 6: Run test to verify it passes**

Run: `cargo test --test services_test visible_flag 2>&1 | tail -5`
Expected: PASS (the other tests still fail to compile until struct literals are updated — see Task 2 Step 1).

- [ ] **Step 7: Commit**

```bash
cd ~/projects/yot-server
git add src/db/schema.rs src/models.rs src/services/event.rs tests/services_test.rs
git commit -m "feat(events): visible flag on events (schema, models, create/update)"
```

### Task 2: List filtering (`includeHidden`)

**Files:**
- Modify: `src/models.rs` (`EventQuery`), `src/services/event.rs` (`list`), `tests/services_test.rs` (existing `EventQuery` literals + new test)

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn list_excludes_hidden_by_default() {
    let conn = setup();
    let cal = calendar::create(&conn, CreateCalendarInput { name: "c".into(), color: None, description: None }).unwrap();
    event::create(&conn, CreateEventInput {
        calendar_id: cal.id.clone(), title: "shown".into(),
        start_at: "2026-09-01T00:00:00.000Z".into(), end_at: "2026-09-01T01:00:00.000Z".into(),
        all_day: false, description: None, context: None, location: None, url: None, image_path: None,
        visible: Some(true),
    }).unwrap();
    event::create(&conn, CreateEventInput {
        calendar_id: cal.id.clone(), title: "hidden".into(),
        start_at: "2026-09-02T00:00:00.000Z".into(), end_at: "2026-09-02T01:00:00.000Z".into(),
        all_day: false, description: None, context: None, location: None, url: None, image_path: None,
        visible: Some(false),
    }).unwrap();

    let q = |include_hidden: Option<bool>| EventQuery {
        calendar_id: None, from: None, to: None, tag: None, q: None,
        limit: None, offset: None, include_hidden,
    };
    let default_list = event::list(&conn, &q(None)).unwrap();
    assert_eq!(default_list.len(), 1);
    assert_eq!(default_list[0].title, "shown");

    let all = event::list(&conn, &q(Some(true))).unwrap();
    assert_eq!(all.len(), 2);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test services_test list_excludes_hidden 2>&1 | tail -5`
Expected: FAIL — "missing field `include_hidden`" on `EventQuery` literals (existing test literals at services_test.rs:334-370 and import_test.rs:54 must gain `include_hidden: None` — that is the compile break).

- [ ] **Step 3: Implement**

`src/models.rs` `EventQuery`:

```rust
    #[serde(default)]
    pub include_hidden: Option<bool>,
    #[serde(rename = "includeHidden")] // NOTE: cannot have two attributes in one slot —
    // actual code: use serde rename on the SAME field:
```

Final field (single attribute form — the query param is `includeHidden` to match the API's camelCase):

```rust
    #[serde(default, rename = "includeHidden")]
    pub include_hidden: Option<bool>,
```

Fix existing literals: `tests/services_test.rs` lines 334, 337, 340, 343, 346, 349, 370 and `tests/import_test.rs` line 54 — add `include_hidden: None` to each.

`src/services/event.rs` `list()` — inside the condition builder, after the `q` block:

```rust
    if query.include_hidden != Some(true) {
        conditions.push("e.visible = 1".to_string());
    }
```

- [ ] **Step 4: Run tests**

Run: `cargo test --test services_test 2>&1 | tail -5 && cargo test --test import_test 2>&1 | tail -3`
Expected: PASS, all green.

- [ ] **Step 5: Commit**

```bash
git add src/models.rs src/services/event.rs tests/services_test.rs tests/import_test.rs
git commit -m "feat(events): exclude hidden events from list by default (includeHidden=true escape hatch)"
```

### Task 3: SSE suppression + MCP wiring

**Files:**
- Modify: `src/rest/events.rs` (create/update emits), `src/mcp/server.rs` (tool_create_event, tool_update_event, tool definitions), `tests/sse_emit_test.rs`

- [ ] **Step 1: Write the failing test**

Add to `tests/sse_emit_test.rs` (uses its `harness()` — router + real `EventBus`; subscribe before the call, assert frames):

```rust
#[tokio::test]
async fn hidden_event_create_does_not_broadcast() {
    let h = harness();
    let mut rx = h.bus.subscribe();
    // Create a calendar first (write key path exists in this harness; see existing tests for the
    // exact auth headers helper used there — reuse `post_json`-style helpers from the same file).
    let cal = create_calendar_via_api(&h).await;
    let (status, body) = post_events(&h.app, &cal["id"].as_str().unwrap(), json!({
        "calendar_id": cal["id"].as_str().unwrap(),
        "title": "ghost flight",
        "start_at": "2026-09-10T00:00:00.000Z",
        "end_at": "2026-09-10T01:00:00.000Z",
        "visible": false
    })).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["visible"], false);

    // No event frame: give the bus a beat via a smoke mutation that DOES emit.
    let (_, body2) = post_events(&h.app, &cal["id"].as_str().unwrap(), json!({
        "calendar_id": cal["id"].as_str().unwrap(),
        "title": "real",
        "start_at": "2026-09-11T00:00:00.000Z",
        "end_at": "2026-09-11T01:00:00.000Z",
        "visible": true
    })).await;
    let frame = rx.try_recv().expect("visible create must broadcast");
    assert_eq!(frame.r#type, "event.created");
    assert_eq!(frame.data["title"], "real");

    // Unhide the ghost: now it broadcasts.
    let id = body["id"].as_str().unwrap().to_string();
    let (s2, _) = patch_event(&h.app, &id, json!({ "visible": true })).await;
    assert_eq!(s2, StatusCode::OK);
    let frame2 = rx.try_recv().expect("visible transition must broadcast");
    assert_eq!(frame2.r#type, "event.updated");
    assert_eq!(frame2.data["title"], "ghost flight");
}
```

Helper shims (if the file lacks them — check for existing `post_json`/`patch_json` first and reuse):

```rust
async fn post_events(app: &Router, _cal_id: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder().method("POST").uri("/api/events")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string())).unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(json!({})))
}

async fn patch_event(app: &Router, id: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder().method("PATCH").uri(&format!("/api/events/{id}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string())).unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(json!({})))
}

async fn create_calendar_via_api(h: &Harness) -> Value {
    let req = Request::builder().method("POST").uri("/api/calendars")
        .header("content-type", "application/json")
        .body(Body::from(json!({"name": "flights"}).to_string())).unwrap();
    let resp = h.app.clone().oneshot(req).await.unwrap();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}
```

(Verify the actual route prefix `/api/…` and auth requirements against existing tests in the file before writing — the harness may already authenticate every request.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test sse_emit_test hidden_event 2>&1 | tail -8`
Expected: FAIL — the first `rx.try_recv()` receives a `event.created` frame for the ghost event (broadcast currently unconditional), or the patch assertion fails.

- [ ] **Step 3: Implement**

`src/rest/events.rs` — `create_event`:

```rust
    let event = state.db.call(move |conn| crate::services::event::create(conn, input)).await?;
    if event.visible {
        state.bus.emit("event.created", serde_json::to_value(&event).unwrap());
    }
```

`update_event` — broadcast only on transition or already-visible:

```rust
    let event = state.db.call(move |conn| crate::services::event::update(conn, &id, input)).await?;
    if event.visible {
        state.bus.emit("event.updated", serde_json::to_value(&event).unwrap());
    }
```

(This covers both "stays visible" (normal updates must still broadcast) and "hidden → visible transition". "visible → hidden" is silent — clients learn on next fetch. Same change in `src/mcp/server.rs` for `tool_create_event` and `tool_update_event`: wrap the two `self.emit(...)` calls in `if ev.visible { ... }`.)

MCP tool definitions (`src/mcp/server.rs` `tool_definitions`): add `"visible": {"type": "boolean"}` to `create_event` and `update_event` schemas, and `"includeHidden": {"type": "boolean"}` to `list_events`.

- [ ] **Step 4: Run tests**

Run: `cargo test --test sse_emit_test 2>&1 | tail -5 && cargo test 2>&1 | tail -3`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/rest/events.rs src/mcp/server.rs tests/sse_emit_test.rs
git commit -m "feat(events): suppress SSE broadcast for hidden events; wire visible into MCP tools"
```

### Task 4: Plugin `source` binding — parse + validate

**Files:**
- Modify: `src/rest/plugins.rs`

- [ ] **Step 1: Write the failing test**

New file `tests/plugins_source_test.rs` (self-contained: tempdir plugin file + in-memory Db; the router harness pattern comes from `tests/sse_emit_test.rs` — `AppState` needs `config`? No: `plugin_dir` lives in `state.config` per `rest/plugins.rs`; check `AppState` — if `config` is not a field, instantiate the plugin-dir path the way `rest/mod.rs` does. The harness in sse_emit_test does NOT set plugin_dir, so this test builds its own `AppState`):

```rust
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

use yot_server::auth::pairing::PairingService;
use yot_server::auth::rate_limit::RateLimiter;
use yot_server::core::event_bus::EventBus;
use yot_server::db::Db;
use yot_server::mcp::server::McpServer;
use yot_server::rest::oauth::AuthCodeStore;
use yot_server::rest::AppState;

fn harness_with_plugin(spec: Value) -> (Router, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("yot-plugins-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("flight-manager.json"), spec.to_string()).unwrap();

    let db = Db::open_in_memory().unwrap();
    let bus = EventBus::new();
    let mcp_conn = rusqlite::Connection::open_in_memory().unwrap();
    yot_server::db::schema::initialize(&mcp_conn).unwrap();
    let mcp = Arc::new(McpServer {
        conn: Mutex::new(mcp_conn),
        scope: "write".to_string(),
        bus: bus.clone(),
    });
    let state = AppState {
        db,
        bus: bus.clone(),
        pairing: Arc::new(PairingService::new()),
        rate_limiter: Arc::new(RateLimiter::new()),
        mcp,
        auth_codes: Arc::new(AuthCodeStore::new()),
        config: Config { plugin_dir: dir.clone(), ..todo!() }, // <-- fill exact Config construction
    };
    (rest::build_router(state), dir)
}
```

IMPORTANT: read `src/rest/mod.rs` / `src/config.rs` first and construct `Config` exactly as the binary does (`Config::from_env`-style or struct literal with all fields — write out the real thing, no `todo!()`).

Test cases:

```rust
#[tokio::test]
async fn source_calendar_merges_events_into_items() { /* Task 5 covers full merge; here pin parse+fallback */ }

#[tokio::test]
async fn invalid_source_falls_back_to_static_items() {
    let spec = json!({
        "id": "flight-manager", "title": "Flights", "description": "d", "version": 1,
        "data": { "franchises": [{"name": "ANA", "abbr": "ANA", "color": "#0066B3"}],
                  "items": [{"id": "fl-1", "title": "HND→SFO", "franchise": "ANA", "type": "flight", "start": "2026-08-17", "end": "2026-08-17", "desc": "t"}] },
        "source": { "calendarId": 42 } // wrong type
    });
    let (app, _dir) = harness_with_plugin(spec);
    let resp = app.clone().oneshot(Request::builder().method("GET").uri("/api/plugins/flight-manager")
        .body(Body::empty()).unwrap()).await.unwrap();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["data"]["items"].as_array().unwrap().len(), 1); // static items served
    assert!(body.get("source").is_none() || body["source"].is_null() || body["source"].is_object());
}

#[tokio::test]
async fn missing_calendar_yields_empty_items() {
    // valid source {calendarId: "nope"} → 200, data.items == []
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test plugins_source_test 2>&1 | tail -5`
Expected: FAIL — `source` currently passes through untouched (spec served verbatim), so `missing_calendar_yields_empty_items` fails (items stay static).

- [ ] **Step 3: Implement — source parsing**

`src/rest/plugins.rs` (above `routes()`):

```rust
#[derive(Debug, Deserialize)]
struct PluginSource {
    #[serde(rename = "calendarId")]
    calendar_id: String,
    #[serde(default)]
    #[serde(rename = "type")]
    item_type: Option<String>,
    #[serde(default, rename = "franchiseField")]
    franchise_field: Option<String>,
    #[serde(default, rename = "franchiseDefault")]
    franchise_default: Option<String>,
    #[serde(default)]
    map: std::collections::HashMap<String, String>,
}
```

In `get_plugin`, after parsing `spec: Value`:

```rust
    let spec = match serde_json::from_value::<PluginSource>(spec.get("source").cloned().unwrap_or(Value::Null)) {
        Ok(src) => {
            match crate::services::plugin_source::merge(&state.db, &src).await {
                Ok(merged_items) => {
                    let mut spec = spec;
                    spec["data"]["items"] = Value::Array(merged_items);
                    if spec.get("source").map(|s| s.is_null()).unwrap_or(false) { spec.as_object_mut().unwrap().remove("source"); }
                    spec
                }
                Err(e) => {
                    tracing::warn!("plugin {id}: source merge failed, serving static items: {e}");
                    spec
                }
            }
        }
        Err(e) => {
            if !spec.get("source").map(|v| v.is_null()).unwrap_or(true) {
                tracing::warn!("plugin {id}: invalid source, serving static items: {e}");
            }
            spec
        }
    };
```

New file `src/services/plugin_source.rs`:

```rust
use serde_json::{json, Map, Value};
use rusqlite::params;

use crate::core::error::AppError;
use crate::rest::AppState; // no — services must not depend on rest. Pass &Connection instead.

pub struct SourceSpec {
    pub calendar_id: String,
    pub item_type: Option<String>,
    pub franchise_field: Option<String>,
    pub franchise_default: Option<String>,
    pub map: std::collections::HashMap<String, String>,
}

const RESERVED: [&str; 6] = ["id", "title", "start", "end", "desc", "franchise"];

/// Load events for a bound calendar and map them into plugin items.
/// Note: hidden events ARE included — plugins are allowed to see them.
pub fn merge_items(conn: &rusqlite::Connection, src: &SourceSpec) -> Result<Vec<Value>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, context, start_at, end_at FROM events \
         WHERE calendar_id = ? AND visible_in(?) ORDER BY start_at LIMIT 200",
    )?;
    ...
}
```

(Final function takes `&Connection` — NOT `AppState`. `type` defaults to `"flight"`? No — default `"item"`; if `source.type` absent use `"item"`.)

Mapping rules (implement exactly):

```rust
    let mut items = Vec::new();
    for row in rows {
        // id: format!("ev:{}", id)
        // title: title
        // start: start_at, end: end_at (strings as stored)
        // desc: description.unwrap_or_default()
        // type: src.item_type.clone().unwrap_or_else(|| "item".into())
        // franchise: context[franchise_field] as string, else franchise_default.unwrap_or("default")
        // parse context JSON: serde_json::from_str::<Value>(&ctx).unwrap_or(json!({})) + warn
        //   - non-object context → {} + warn
        // spread context object entries except RESERVED and the franchise_field key
        // apply map: if context had key K and map contains K → insert under map[K] instead
        // item["id"]=... etc. in this order; build via serde_json::Map
    }
    Ok(items)
```

- [ ] **Step 4: Run tests**

Run: `cargo test --test plugins_source_test 2>&1 | tail -5`
Expected: PASS (`invalid_source_falls_back`, `missing_calendar_yields_empty` green; full-merge test lands in Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/rest/plugins.rs src/services/plugin_source.rs tests/plugins_source_test.rs
git commit -m "feat(plugins): parse source binding with static-items fallback"
```

### Task 5: Merge query + mapping (the real merge)

**Files:**
- Modify: `src/services/plugin_source.rs`, `tests/plugins_source_test.rs`

- [ ] **Step 1: Write the failing test** (in `plugins_source_test.rs`, using the service directly — simpler than router round-trip)

```rust
#[test]
fn merge_maps_events_to_items() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    yot_server::db::schema::initialize(&conn).unwrap();
    conn.execute("INSERT INTO calendars (id, name, created_at, updated_at) VALUES ('flights', 'Flights', '2026-01-01', '2026-01-01')", []).unwrap();
    conn.execute("INSERT INTO events (id, calendar_id, title, description, context, start_at, end_at, all_day, visible, created_at, updated_at) VALUES
        ('e1', 'flights', 'HND → LHR', 'Terminal 3 · Gate 65', '{\"airline\": \"JAL\", \"flight_no\": \"JL041\", \"gate\": \"65\", \"status\": \"Scheduled\"}', '2026-08-28T10:00:00.000Z', '2026-08-28T10:00:00.000Z', 0, 1, '2026-01-01', '2026-01-01'),
        ('e2', 'flights', 'NRT → SEA', 'Delayed 40 min', '{\"airline\": \"Delta\", \"flight_no\": \"DL276\", \"status\": \"Delayed\"}', '2026-09-06T05:00:00.000Z', '2026-09-06T05:00:00.000Z', 0, 1, '2026-01-01', '2026-01-01')", []).unwrap();

    let src = yot_server::services::plugin_source::SourceSpec {
        calendar_id: "flights".into(),
        item_type: Some("flight".into()),
        franchise_field: Some("airline".into()),
        franchise_default: None,
        map: [("flight".to_string(), "flight_no".to_string()), ("status".to_string(), "status".to_string())].into_iter().collect(),
    };
    let items = yot_server::services::plugin_source::merge_items(&conn, &src).unwrap();

    assert_eq!(items.len(), 2);
    let first = &items[0];
    assert_eq!(first["id"], "ev:e1");
    assert_eq!(first["title"], "HND → LHR");
    assert_eq!(first["start"], "2026-08-28T10:00:00.000Z");
    assert_eq!(first["end"], "2026-08-28T10:00:00.000Z");
    assert_eq!(first["desc"], "Terminal 3 · Gate 65");
    assert_eq!(first["type"], "flight");
    assert_eq!(first["franchise"], "JAL");
    assert_eq!(first["flight"], "JL041");   // map: flight ← flight_no
    assert_eq!(first["gate"], "65");
    let second = &items[1];
    assert_eq!(second["franchise"], "Delta");
    assert!(second.get("gate").is_none()); // absent in context → absent in item
}

#[test]
fn broken_context_never_drops_event() {
    // insert one event with context = "not json{" → item still produced, desc/type/franchise correct
}

#[test]
fn franchise_falls_back_to_default() {
    // context without the franchise field → franchise == franchise_default.unwrap_or("default")
}
```

- [ ] **Step 2: Run to verify fail → implement the SELECT with real rusqlite**

```rust
pub fn merge_items(conn: &rusqlite::Connection, src: &SourceSpec) -> Result<Vec<Value>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, context, start_at, end_at FROM events \
         WHERE calendar_id = ? ORDER BY start_at LIMIT 200",
    )?;
    let rows: Vec<(String, String, Option<String>, Option<String>, String, String)> = stmt
        .query_map(params![src.calendar_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut items = Vec::new();
    for (id, title, description, context, start_at, end_at) in rows {
        let ctx: Value = match context.as_deref() {
            Some(s) => serde_json::from_str(s).unwrap_or_else(|e| {
                tracing::warn!("plugin source: broken context JSON on event {id}: {e}");
                json!({})
            }),
            None => json!({}),
        };
        let ctx = if !ctx.is_object() { json!({}) } else { ctx };
        let ctx_obj = ctx.as_object().cloned().unwrap_or_default();

        let franchise = src
            .franchise_field
            .as_ref()
            .and_then(|f| ctx_obj.get(f))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| src.franchise_default.clone())
            .unwrap_or_else(|| "default".to_string());

        let mut item = Map::new();
        item.insert("id".into(), json!(format!("ev:{id}")));
        item.insert("title".into(), json!(title));
        item.insert("start".into(), json!(start_at));
        item.insert("end".into(), json!(end_at));
        item.insert("desc".into(), json!(description.unwrap_or_default()));
        item.insert("type".into(), json!(src.item_type.clone().unwrap_or_else(|| "item".into())));
        item.insert("franchise".into(), json!(franchise));

        // Spread non-reserved context keys, applying renames.
        for (k, v) in ctx_obj {
            if RESERVED.contains(&k.as_str()) || Some(&k) == src.franchise_field.as_ref() {
                continue;
            }
            let out_key = src.map.get(&k).cloned().unwrap_or(k);
            item.insert(out_key, v);
        }
        items.push(Value::Object(item));
    }
    Ok(items)
}
```

Type-annotation caveat: `RESERVED` must be `&[&str]` — declare `const RESERVED: &[&str] = &["id", "title", "start", "end", "desc", "franchise"];` and use `RESERVED.contains(&k.as_str())`.

Note: no `visible` predicate here — plugins see hidden events by design (spec §4).

- [ ] **Step 3: Run tests**

Run: `cargo test --test plugins_source_test 2>&1 | tail -5 && cargo test 2>&1 | tail -3`
Expected: PASS, full suite green.

- [ ] **Step 4: Commit**

```bash
git add src/services/plugin_source.rs tests/plugins_source_test.rs
git commit -m "feat(plugins): merge bound calendar events into plugin items (context spread + field map)"
```

### Task 6: Migrate `flight-manager.json` + live verification

**Files:**
- Modify: `~/.yot/plugins/flight-manager.json` (live data dir, NOT in the repo)
- Modify: `src/services/plugin_source.rs` (only if live check exposes a mapping bug)

- [ ] **Step 1: Create the `flights` calendar + migrate the spec**

Via MCP tools (`mcp__yot__create_calendar`, then edit the JSON file directly):

```json
{
  "id": "flight-manager",
  "title": "Flights",
  "description": "Upcoming flights — countdown to departure, route and gate at a glance.",
  "version": 7,
  "data": {
    "franchises": [
      { "name": "ANA", "abbr": "ANA", "color": "#0066B3" },
      { "name": "JAL", "abbr": "JAL", "color": "#D70035" },
      { "name": "Delta", "abbr": "DL", "color": "#003366" },
      { "name": "Emirates", "abbr": "EK", "color": "#D71920" }
    ],
    "items": []
  },
  "derive": { "group": { "mode": "static", "value": "" } },
  "listRow": { "...unchanged from current spec..." },
  "detail": { "...unchanged from current spec..." },
  "list": { "...unchanged from current spec..." },
  "actions": { "...unchanged from current spec..." },
  "source": {
    "calendarId": "<real-uuid-of-flights-calendar>",
    "type": "flight",
    "franchiseField": "airline",
    "franchiseDefault": "ANA",
    "map": { "flight": "flight_no", "status": "status", "gate": "gate" }
  }
}
```

Steps: create calendar via MCP → capture its id → rewrite `flight-manager.json` with `source` (preserving listRow/detail/list/actions verbatim from the current file, bump version to 7).

- [ ] **Step 2: Seed events via MCP `create_event`**

For each current static item (fl-1…fl-5), create an event in the `flights` calendar with `visible: false` and `context` JSON matching the map:

```json
{
  "calendar_id": "<flights-uuid>",
  "title": "HND → SFO",
  "start_at": "2026-08-17T00:00:00+09:00",
  "end_at": "2026-08-17T23:59:59+09:00",
  "visible": false,
  "context": "{\"airline\": \"ANA\", \"flight_no\": \"NH204\", \"gate\": \"112\", \"status\": \"On time\", \"seat\": \"24A\", \"terminal\": \"3\", \"origin\": \"HND\", \"destination\": \"SFO\"}"
}
```

(Note `origin`/`destination`/`seat`/`terminal` are NOT in `map` — they pass through under their own names, which is exactly what `{{item.origin}}` etc. expect.)

- [ ] **Step 3: Verify the merged spec**

```bash
curl -s http://localhost:4010/api/plugins/flight-manager | python3 -m json.tool | head -40
```

Expected: `data.items` has 5 items with `id` starting `ev:`, `franchise` from context, `flight`/`gate`/`status` present. Also:

```bash
curl -s "http://localhost:4010/api/events?limit=500" | python3 -c "import json,sys; d=json.load(sys.stdin); names=[e['title'] for e in d]; print(len([n for n in names if '→' in n]))"
```

Expected: `0` (hidden flights invisible in the default calendar listing).

- [ ] **Step 4: Restart the live server with the new binary**

```bash
cd ~/projects/yot-server
cargo build --release 2>&1 | tail -3
cp target/release/yot-server ~/.yot/yot-server
systemctl --user restart yot-server
sleep 2 && systemctl --user is-active yot-server && curl -s http://localhost:4010/api/calendars | head -c 200
```

Expected: `active`, JSON returned. (Binary copy while running is safe — old process runs from the unlinked inode.)

- [ ] **Step 5: Full regression**

```bash
cd ~/projects/yot-server && cargo test 2>&1 | tail -3
```

Expected: all green. Then, if the yot-client test suite is touchable from this repo: `cd ~/projects/yot-client && npm test 2>&1 | tail -4` — expect 425 passing, known ask-flake excluded. Server changes must not affect it at all (client untouched).

- [ ] **Step 6: Commit + PR**

```bash
cd ~/projects/yot-server
git push -u origin feat/event-visibility-plugin-source
gh pr create --repo eitaar/yot-server --base main --head plana-tan:feat/event-visibility-plugin-source \
  --title "feat: event visibility flag + plugin source binding (server-side merge)" \
  --body "Design: docs/superpowers/specs/2026-08-29-event-visibility-plugin-source-design.md

- events.visible column (default 1, add_column_if_missing migration)
- GET /events excludes hidden by default; includeHidden=true escape hatch (REST + MCP)
- SSE event.created/updated suppressed while hidden; broadcast on visible transition
- plugin source binding: GET /api/plugins/{id} merges a bound calendar's events into data.items (context spread + field map), static-items fallback on invalid source
- MCP tools: visible on create/update_event, includeHidden on list_events
- hidden events remain visible to plugins by design
- client untouched (ItemSchema.catchall + non-strict spec verified)"
```

If `gh pr create` reports the fork head differently, use `--head plana-tan:feat/event-visibility-plugin-source` (fork PR convention already established).

---

## Self-Review (done during planning)

- Spec coverage: §1 column → Task 1; §2 API → Tasks 1-2 + MCP in Task 3; §3 SSE → Task 3; §4 source → Tasks 4-5; §5 errors → Task 4 fallback + Task 5 broken-context test; §6 testing → every task + Task 6 live check; rollout order matches.
- Known plan rough edges (executor fixes them as compiler dictates, they are mechanical):
  - Task 1 test literal uses `visible: Some(...)` on both create/update inputs — matches final model choice.
  - Task 2 serde attribute note in the plan text is instructional; final code is the single-attribute form.
  - Task 4 harness `Config` construction — executor must read `src/config.rs`/`src/rest/mod.rs` and write the real construction (no `todo!()`); `plugin_dir` is read from `state.config.plugin_dir` in `rest/plugins.rs`.
  - Task 5 `RESERVED` is `&[&str]`.
- Deliberate: `merge_items` takes `&Connection` (service layer does not depend on rest); plugins include hidden events (spec §4); map renames only re-key context fields (they never overwrite id/title/start/end/desc/franchise since those are in RESERVED).
