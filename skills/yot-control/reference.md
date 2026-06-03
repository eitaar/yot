# yot reference

Full detail for driving yot. The [SKILL.md](SKILL.md) covers the day-to-day
workflow; consult this file for exact parameters, return shapes, the REST
surface, and error handling.

## Connecting

### MCP (preferred for agents)

The yot MCP server runs over **stdio** — the client spawns it and talks JSON-RPC
over stdin/stdout. Configure it (e.g. in `.mcp.json`), passing the API key in the
process environment:

```json
{
  "mcpServers": {
    "yot": {
      "command": "npx",
      "args": ["tsx", "src/mcp/stdio.ts"],
      "env": { "YOT_API_KEY": "cal_xxxx" }
    }
  }
}
```

The key's scope (`read` / `write`) is resolved once at startup. Tool names are
`list_calendars`, `create_event`, etc.; some hosts namespace them as
`mcp__yot__<tool>`.

### REST (fallback / programmatic clients)

Base path `/api` (default `http://localhost:4010/api`). Authenticate every
request with the API key:

```
Authorization: Bearer cal_xxxx
```

Also accepted: `X-API-Key: cal_xxxx`, a bare `Authorization: cal_xxxx`, or a
`?key=cal_xxxx` query parameter (handy for `EventSource`). Interactive docs at
`/api/ui`, raw OpenAPI at `/api/doc`.

**Scopes:** `read` keys may only do GET / read tools; `write` keys may do
everything. A mutation with a `read` key returns `403` (REST) or an error tool
result (MCP).

## Data model

```
calendars ──< events ──< reminders
                  └──< event_tags >── tags
```

- **Calendar** — `id`, `name`, `color?`, `description?`, `created_at`,
  `updated_at`.
- **Event** — `id`, `calendar_id`, `title`, `description?` (rendered as Markdown
  in the web UI), `location?`, `start_at`, `end_at`, `all_day` (boolean),
  `image_path?` (cover-image filename), `url?`, `source_uid?` (set only for
  `.ics`-imported events), `created_at`, `updated_at`, `tags` (array of tag
  **names**), `reminders` (embedded array).
- **Reminder** — `id`, `event_id`, `minutes_before`, `method` (stored metadata;
  never fired by the server).
- **Tag** — `id`, unique `name`, `color?`. Linked to events many-to-many.

Timestamps are ISO-8601 strings (UTC). `end_at` must be ≥ `start_at`. Recurring
events are intentionally out of scope.

## MCP tools (full)

All write tools return an error result for a read-scoped connection. A successful
call returns the JSON of the affected resource; a void operation (deletes) returns
`{ "ok": true }`. Errors return `{ isError: true }` with the message as text.

| Tool | Scope | Input | Returns |
|---|---|---|---|
| `list_calendars` | read | — | `Calendar[]` |
| `create_calendar` | write | `name`, `color?`, `description?` | `Calendar` |
| `update_calendar` | write | `id`, `name?`, `color?`, `description?` | `Calendar` |
| `delete_calendar` | write | `id` | `{ ok: true }` (cascades to its events) |
| `list_events` | read | `calendarId?`, `from?`, `to?`, `tag?`, `q?`, `limit?`, `offset?` | `Event[]` |
| `get_event` | read | `id` | `Event` |
| `create_event` | write | `calendar_id`, `title`, `start_at`, `end_at`, `all_day?`, `description?`, `location?`, `url?`, `image_path?` | `Event` |
| `update_event` | write | `id` + any event field (omit unchanged) | `Event` |
| `delete_event` | write | `id` | `{ ok: true }` |
| `add_reminder` | write | `event_id`, `minutes_before`, `method?` | `Reminder` |
| `remove_reminder` | write | `event_id`, `reminder_id` | `{ ok: true }` |
| `get_event_image` | read | `id` | image content block (or a "no cover" message) |
| `upload_image_from_url` | write | `url` | `{ path }` (set as an event's `image_path`) |
| `import_ics` | write | `calendar_id`, `ics` | `ImportSummary` |
| `list_tags` | read | — | `Tag[]` |
| `create_tag` | write | `name`, `color?` | `Tag` (use its `id` to attach) |
| `update_tag` | write | `id`, `name?`, `color?` | `Tag` |
| `delete_tag` | write | `id` | `{ ok: true }` |
| `tag_event` | write | `event_id`, `tag_id` | `Event` (with updated tags) |
| `untag_event` | write | `event_id`, `tag_id` | `Event` |

**Defaults / constraints:**
- `all_day` defaults to `false`.
- `minutes_before` is an integer ≥ 0; `method` defaults to `"notification"`.
- `create_calendar` then `create_event`: the calendar must already exist.
- `tag_event` requires both the event and the tag to already exist.
- `get_event_image` returns the cover as a viewable image block (so a multimodal
  agent can see it); events with no `image_path` return a short text message.
- `upload_image_from_url` fetches an http(s) image (≤ 5 MB; private/loopback hosts
  refused) and returns `{ path }` — set it as an event's `image_path`.
- `import_ics` takes the iCalendar **text** directly (the REST route takes a
  file); `calendar_id` must already exist.

The MCP tools now cover the full REST CRUD. **REST only** (no MCP equivalent):
the SSE `/stream` feed and the auth pairing routes (`/auth/*`) — see below.

### `list_events` query semantics

| Param | Meaning |
|---|---|
| `calendarId` | restrict to one calendar |
| `from` | lower bound on `start_at`, inclusive (ISO-8601) |
| `to` | upper bound on `start_at`, inclusive (ISO-8601) |
| `tag` | only events carrying this tag **name** |
| `q` | substring match against title and description |
| `limit` | 1–500, default 50 |
| `offset` | ≥ 0, default 0 |

Results are ordered by `start_at` ascending. `from`/`to` filter on the event's
**start**, so a long event that started before `from` will not appear even if it
overlaps the window.

## REST endpoints

| Method | Path | Auth | Body | Success |
|---|---|---|---|---|
| GET | `/health` | public | — | `{ status: "ok" }` |
| POST | `/auth/pair` | public | `{ pin }` | 200 + session cookie |
| POST | `/auth/logout` | public | — | 200 + cookie cleared |
| POST | `/auth/pin` | authed | `{ scope? }` | `{ pin, scope, expires_in }` |
| GET | `/auth/session` | authed | — | `{ scope }` |
| GET / POST | `/calendars` | read / write | CreateCalendar | `Calendar[]` / `Calendar` |
| GET / PATCH / DELETE | `/calendars/{id}` | read / write / write | UpdateCalendar | `Calendar` / 204 |
| GET / POST | `/events` | read / write | CreateEvent | `Event[]` / `Event` |
| GET / PATCH / DELETE | `/events/{id}` | read / write / write | UpdateEvent | `Event` / 204 |
| POST | `/events/{id}/reminders` | write | CreateReminder | `Reminder` |
| DELETE | `/events/{id}/reminders/{rid}` | write | — | 204 |
| POST / DELETE | `/events/{id}/tags/{tagId}` | write | — | `Event` |
| POST | `/events/import` | write | multipart `.ics` + `calendar_id` | `ImportSummary` |
| POST | `/uploads/image` | write | multipart `file` | `{ path }` |
| POST | `/uploads/image-from-url` | write | `{ url }` | `{ path }` |
| GET | `/img/{file}` | read | — | image bytes |
| GET / POST | `/tags` | read / write | CreateTag | `Tag[]` / `Tag` |
| PATCH / DELETE | `/tags/{id}` | write | UpdateTag | `Tag` / 204 |
| GET | `/stream` | read | — | `text/event-stream` (SSE) |

`?key=cal_xxxx` is accepted on any authed route.

### Cover images

1. **Get a `path`.** Over MCP: `upload_image_from_url({ url })`. Over REST:
   `POST /uploads/image` (`multipart/form-data`, field `file`) — MIME must be
   `image/jpeg|png|webp|gif`, ≤ 5 MB — or `POST /uploads/image-from-url` with
   `{ url }`. All return `{ "path": "<uuid>.<ext>" }` (http(s) only,
   private/loopback addresses refused). Raw multipart upload is REST-only.
2. Set the event's `image_path` to the returned filename (`create_event` /
   `update_event` accept `image_path`).
3. View it. Over MCP: `get_event_image({ id })` returns a viewable image block.
   Over REST: `GET /api/img/{filename}` returns the bytes.

### `.ics` import

Over MCP: `import_ics({ calendar_id, ics })` — pass the iCalendar **text**
directly. Over REST: `POST /events/import` — `multipart/form-data` with a `file`
(iCalendar, ≤ 10 MB) and a `calendar_id`. The `calendar_id` must exist. Each
`VEVENT` becomes a one-off event. Response:

```jsonc
{ "created": number,
  "skippedRecurring": number,   // VEVENTs with an RRULE
  "skippedDuplicate": number,   // UID already imported (matched on source_uid)
  "errors": string[] }
```

Re-importing the same file is idempotent (events store the source `UID`).

## Realtime (SSE)

`GET /api/stream` is a Server-Sent Events feed of every change (from REST or MCP).
The SSE `event:` name is the change type; `data:` is JSON. Types:
`calendar.created|updated|deleted`, `event.created|updated|deleted`,
`tag.created|updated|deleted`. A `ready` frame is sent on connect and a periodic
`ping` keeps the connection alive. Agents generally don't need this; it powers
the web UI's live updates.

## Errors

REST errors use `{ "error": { "code", "message", "details?" } }`. MCP surfaces
the same message in an `isError` tool result.

| Status | code | When |
|---|---|---|
| 400 | `validation_error` | bad request body, or `end_at` < `start_at` |
| 401 | `unauthorized` | missing / invalid / revoked key |
| 403 | `forbidden` | read-scoped key attempted a mutation |
| 404 | `not_found` | calendar / event / tag / reminder id does not exist |
| 409 | `conflict` | tag name already exists |
| 429 | `rate_limited` | too many failed `/auth/pair` attempts |
| 500 | `internal_error` | unexpected server error |

## Worked example (REST)

```bash
KEY=cal_xxxx
# 1. find or make a calendar
curl -H "Authorization: Bearer $KEY" http://localhost:4010/api/calendars
curl -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"name":"Work","color":"#3b82f6"}' http://localhost:4010/api/calendars
# 2. create an event in it (note UTC ISO timestamps)
curl -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"calendar_id":"<id>","title":"Standup",
       "start_at":"2026-06-10T09:00:00.000Z","end_at":"2026-06-10T09:15:00.000Z"}' \
  http://localhost:4010/api/events
# 3. this week's events
curl -H "Authorization: Bearer $KEY" \
  "http://localhost:4010/api/events?from=2026-06-08T00:00:00Z&to=2026-06-14T23:59:59Z"
```
