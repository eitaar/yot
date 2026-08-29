# Event Visibility + Plugin Source Binding — Design

Date: 2026-08-29
Status: Approved (brainstorming session, eitaar + Plana)
Scope: yot-server only. Zero client changes required for v1.

## Goal

1. Events written by agents can be hidden from the calendar (`visible` flag).
2. Plugins can bind to a calendar as their data source (server-side merge),
   replacing static `data.items` — starting with the Flights plugin.

Constraints from prior decisions: no arbitrary code execution (declarative
JSON plugins only); data fetching is the agent's job (fetch was removed from
the spec); v1 touches the agent API only — no app UI toggle until the next
client rebuild cycle.

## Decisions (approved)

- Visible-flag control: agent API only in v1 (DB + REST + MCP). UI toggle deferred.
- First binding target: personal data (Flights). F1 stays static for now.
- Filter location: server-side, via new query param (old clients keep working).
- Approach: A — server-side merge. Client rebuild NOT required:
  - `ItemSchema` uses `.catchall(z.unknown())` — extra item fields pass zod.
  - `TrackingPluginSpecSchema` is non-strict — unknown top-level `source` is
    stripped silently by old builds (natural fallback to static data).
- SSE: hidden events are not broadcast; broadcast on visible transition only.
- v1 spec migration: `flight-manager` only. `f1-2026` stays static.

## 1. DB: `visible` column

```sql
ALTER TABLE events ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;
```

- Added via existing `add_column_if_missing(conn, "events", "visible", "INTEGER NOT NULL DEFAULT 1")`.
- Existing rows are all visible (default 1). No backfill needed.
- `context` stays as-is (agent free-form JSON, `parking/prices/...` + binding fields).

## 2. API changes (yot-server)

- `POST /events`, `PATCH /events/{id}`: accept optional `visible: bool`.
  Omitted on update = keep current value.
- `GET /events`: new optional param `include_hidden=true` → return all.
  Default: exclude `visible = 0`. Old clients (no param) get the filtered
  list — calendar cleans itself up on next fetch.
- MCP event tools mirror the REST changes.

## 3. SSE

- `visible = 0` events: no `event.created` / `event.updated` broadcast.
- Transition to `visible = 1`: broadcast `event.updated` normally.
- Client's local cache may still hold a hidden event until next fetch — acceptable.

## 4. Plugin `source` binding (server merge)

Plugin spec gains an optional top-level field:

```json
"source": {
  "calendarId": "flights",
  "type": "flight",
  "franchiseField": "airline",
  "franchiseDefault": "ANA",
  "map": { "flight": "flight_no", "status": "status", "gate": "gate" }
}
```

`GET /api/plugins/{id}` merge algorithm (when valid `source` present):

1. Select events: `calendar_id = ?` ordered by `start_at ASC LIMIT 200`
   (hidden events included — plugins are allowed to see them).
2. Map each event to a plugin item:
   - `id` ← `"ev:" + event.id`
   - `title` ← `event.title`
   - `start` ← `event.start_at`, `end` ← `event.end_at` (null if TBA)
   - `desc` ← `event.description` ("" if null)
   - `type` ← `source.type` (fixed per plugin)
   - `franchise` ← context JSON `[source.franchiseField]`, else
     `source.franchiseDefault`
   - Parse `event.context` as JSON; spread all fields except reserved ones
     (`id/title/start/end/desc/type/franchise`); apply `source.map` renames
     (contextKey → itemKey). `{{item.gate}}` etc. work unchanged.
3. Replace `data.items` with merged items; `data.franchises` from the spec
   is kept as-is (spec owns colors). Specs migrate to static `items: []`.

Field contract the server must uphold (client `ItemSchema`):
`id, title, franchise, type, start (nullable), end (nullable), desc` required
on every merged item.

## 5. Error handling

- Invalid `context` JSON → treat as `{}` + `tracing::warn!`. Never drop the event.
- Unknown/empty calendar → normal response with empty items + warn.
- Invalid `source` (bad shape, unknown fields per zod-equivalent validation in Rust)
  → ignore `source`, serve static `data.items` (old behavior fallback).
- Path-traversal guard on plugin id already exists; unchanged.

## 6. Testing

- Rust unit: event→item mapping (happy path / missing context / broken JSON /
  missing franchise field / map renames); visible filtering SQL; SSE
  suppression on hidden; broadcast on visible transition.
- Integration: seed events in `flights` calendar → `GET /api/plugins/{id}`
  returns merged items in `start_at` order.
- Live check (v1 acceptance): MCP-write a flight event into the `flights`
  calendar → `GET /api/plugins/flight-manager` shows `{{item.flight}}`,
  `{{item.gate}}` fields; calendar view no longer lists hidden events.
- Client: existing test suite stays green untouched (425 passing; known ask
  flake excluded).

## Out of scope (v1)

- App UI toggle for visible (next client rebuild cycle).
- `f1-2026` source migration (agent ingest path for F1 comes later; optional follow-up).
- Tag-based binding, `deleted` tombstones for plugins, pagination beyond LIMIT 200.

## Rollout order

1. `visible` column + `add_column_if_missing`
2. REST/MCP create/update/list param + filtering
3. SSE suppression
4. `source` + server merge in `rest/plugins.rs`
5. Migrate `flight-manager.json` to `source` + seed events via MCP
6. Live verification end-to-end
