# yot — Calendar Backend Specification

Version 1.2 · Status: implemented.

A single-user calendar backend where a **REST API** and an **MCP server** perform
full CRUD over the same data, with **Server-Sent Events** for realtime sync and
**API-key authentication**. A **Vue 3 SPA** provides a browser-based calendar UI
authenticated via a PIN-pairing flow. This document specifies the system as built.

---

## 1. Overview

### 1.1 Goals

- One source of truth for calendar data, reachable through **three surfaces**:
  a REST API (for apps/clients/scripts), an MCP server (for AI agents), and a
  Vue 3 web UI (for browser-based interaction).
- **Realtime fan-out**: any change, from any surface, is broadcast to all
  connected listeners over SSE. The web UI subscribes automatically.
- **Access control**: every data request requires an API key; keys carry a
  `read` or `write` scope. Browser sessions are established via PIN pairing
  and use HttpOnly cookies.

### 1.2 Non-goals (intentionally out of scope)

- **Recurring events** (RRULE / occurrence expansion / per-instance overrides).
- **Reminder delivery**: reminders are stored metadata only; the server does not
  fire notifications or run a scheduler.
- **Multi-user accounts / sharing / per-user data isolation**: this is a
  single-owner system; keys gate access but do not partition data.
- **OAuth** for MCP. Auth is a static API key (header, query param, or disabled).

### 1.3 Technology

| Concern            | Choice                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Runtime            | Node.js 24 (ESM, `NodeNext`)                                                                            |
| HTTP framework     | Hono 4                                                                                                  |
| REST + OpenAPI     | `@hono/zod-openapi`                                                                                     |
| MCP transport      | `@modelcontextprotocol/sdk` `StdioServerTransport` (stdio)                                              |
| Database           | `better-sqlite3` (synchronous)                                                                          |
| Validation/schemas | Zod 4 (via `@hono/zod-openapi`)                                                                         |
| `.ics` parsing     | `ical.js` 2                                                                                             |
| CLI prompts        | `@clack/prompts`                                                                                        |
| Frontend           | Vue 3, Vite 6, Tailwind CSS v4 + DaisyUI 5, Vue Router, Schedule-X v2, `markdown-it`, `vite-plugin-pwa` |
| Lint/format        | Biome                                                                                                   |
| Tests              | `node:test` run through `tsx`                                                                           |

---

## 2. Architecture

### 2.1 Layers

A **shared service layer** owns all database access and business rules. The REST
routes and MCP tools are thin adapters that translate transport-specific input
into service calls and shape the results. Every successful mutation publishes a
change event to an in-process **event bus**, which the SSE endpoint forwards to
clients.

There are **two processes**. The HTTP server hosts the REST API, the SSE feed,
and the web console. The MCP server is a **separate stdio process** spawned by
the MCP client; it talks JSON-RPC over stdin/stdout and runs no HTTP. Both
processes open the same SQLite file but each has its own in-memory event bus.

```
HTTP server process
                       ┌─────────────── SSE clients
                       │  (event bus)
request → auth mw → REST route ──→ service ──→ better-sqlite3
                                      └──→ event bus ──┘
                                             ↑
                     POST /api/internal/events (relay uplink)
                                             │
stdio MCP process (spawned by the client)    │
stdin/stdout ↔ MCP tool ──→ service ──→ better-sqlite3  (same file)
                              └──→ event bus ──→ relay ──┘
```

Because the bus is in-process, the two processes cannot share a single bus
directly. A **relay** bridges them: the MCP process subscribes to its own bus and
POSTs each `ChangeEvent` to the HTTP server's internal endpoint
(`POST /api/internal/events`), which replays it onto the HTTP bus — so changes
made through MCP appear on the SSE feed almost instantly. The relay is one-way
(MCP → HTTP); REST changes are not pushed back to the MCP process.

### 2.2 Source layout

```
src/
  index.ts                 # compose db, services, REST, SSE; serve web/dist SPA; start HTTP server
  db/
    schema.ts              # SCHEMA_SQL (DDL as a TS string)
    connection.ts          # openDb(path): pragmas + idempotent column migration + apply schema
  core/
    errors.ts              # AppError + typed subclasses (status + code)
    id.ts                  # newId() uuid, now() ISO-8601
    event-bus.ts           # EventBus: subscribe/emit (in-process pub/sub)
  schemas/
    common.ts              # isoDateTime() helper
    calendar.ts            # Calendar / CreateCalendar / UpdateCalendar
    event.ts               # Event / CreateEvent / UpdateEvent / EventQuery / Reminder / CreateReminder
    tag.ts                 # Tag / CreateTag / UpdateTag
  services/
    calendar.service.ts    # CRUD; emits calendar.*
    event.service.ts       # CRUD + reminders + tag links + filtered list + .ics dedup; emits event.*
    tag.service.ts         # CRUD; emits tag.*
    image.service.ts       # cover-image storage: save/read/remove, SSRF-guarded fetch-from-URL
    import.service.ts      # IcsImportService: parse .ics, create one-off events, skip recurring/dupes
    container.ts           # createServices(db, bus): Services (calendars, events, tags, apiKeys, pairing, images, importer)
  auth/
    apikey.ts              # ApiKeyService, generateRawKey, hashKey
    pairing.ts             # PairingService: in-memory one-time PIN create/redeem with TTL
    rate-limit.ts          # RateLimiter: fixed-window failure counter
    middleware.ts          # authenticate (reads yot_session cookie), requireWriteForMutations, assertScope
  rest/
    app.ts                 # buildApp(): OpenAPIHono, onError, /doc, /ui, /health, mounts routes
    auth.ts                # public pair/logout + authed pin/session routes
    calendars.ts           # /calendars routes
    events.ts              # /events routes (+ reminders, tag links)
    uploads.ts             # /uploads/image, /uploads/image-from-url, GET /img/:file
    import.ts              # POST /events/import (multipart .ics)
    tags.ts                # /tags routes (incl. PATCH /tags/{id})
    stream.ts              # GET /stream SSE
    internal.ts            # POST /internal/events (relay uplink from MCP)
  mcp/
    server.ts              # buildMcpServer(services, scope): registers 14 tools
    stdio.ts               # stdio MCP entry point: db→services→server→StdioServerTransport
    relay.ts               # startChangeRelay: forwards bus events to HTTP server
scripts/
  init.ts                  # interactive: create API key, save to .env, set MCP auth
  auth.ts                  # interactive: mint a PIN to pair a browser session
  config.ts                # interactive .env editor (PORT / DB_PATH / MCP_AUTH) + API-key management
web/                       # Vue 3 SPA (independent Vite project)
  public/                  # PWA icons (pwa-192x192.svg, pwa-512x512.svg)
  src/
    api/client.ts          # typed REST API client (fetch + cookie auth) + imageSrc() helper
    composables/           # useAuth, useCalendars, useEvents, useTags, useSSE, useTheme,
                           #   useFilters, useFilterSheet, useComposer, useImport, useRefresh,
                           #   useMediaQuery, useSidebar
    lib/markdown.ts        # markdown-it renderer (safe HTML) for event descriptions
    views/                 # CalendarView, ListView (also drives /cover), PairView
    components/            # Sidebar, FiltersPanel, FilterSheet, EventModal, AgendaList,
                           #   CoverGrid, MobileCalendar, BottomDock, ColorPicker, ThemeToggle,
                           #   ImportIcsDialog, PWAInstallButton, calendar/* (Schedule-X glue)
    router.ts              # Vue Router with cached auth guard
    App.vue                # app shell: nav header + bottom dock + import dialog
    main.ts                # app entry point: init theme, register service worker, mount
```

### 2.3 Request lifecycle

1. Global middleware (registered before routes): request logging (server only),
   permissive CORS, secure headers.
2. **Public** endpoints answer without auth: `GET /`, `/api/health`, `/api/doc`,
   `/api/ui`, and the PIN-pairing pair (`POST /api/auth/pair`, `POST /api/auth/logout`).
3. The **auth middleware** runs for `/api/*`: it resolves the API key, rejects
   missing/invalid/revoked keys with `401`, records `last_used_at`, and stashes
   the key on the context. The stdio MCP server resolves its key once at startup
   instead (§5.4), not per request.
4. For REST, a second middleware rejects mutating methods (`403`) when the key is
   `read`-scoped.
5. The route/tool calls the service. Errors thrown by services are mapped to
   responses by a single `onError` handler (REST) or wrapped as tool errors (MCP).

---

## 3. Data model

SQLite. `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`. All ids are
UUID v4 text; all timestamps are ISO-8601 UTC strings; booleans are stored as
`INTEGER` 0/1.

### 3.1 Tables

**calendars**

| Column      | Type          | Notes    |
| ----------- | ------------- | -------- |
| id          | TEXT PK       | uuid     |
| name        | TEXT NOT NULL |          |
| color       | TEXT          | nullable |
| description | TEXT          | nullable |
| created_at  | TEXT NOT NULL | ISO-8601 |
| updated_at  | TEXT NOT NULL | ISO-8601 |

**events**

| Column      | Type             | Notes                                                |
| ----------- | ---------------- | ---------------------------------------------------- |
| id          | TEXT PK          | uuid                                                 |
| calendar_id | TEXT NOT NULL    | FK → calendars(id) ON DELETE CASCADE                 |
| title       | TEXT NOT NULL    |                                                      |
| description | TEXT             | nullable                                             |
| location    | TEXT             | nullable                                             |
| start_at    | TEXT NOT NULL    | ISO-8601                                             |
| end_at      | TEXT NOT NULL    | ISO-8601, must be ≥ start_at                         |
| all_day     | INTEGER NOT NULL | 0/1, default 0                                       |
| image_path  | TEXT             | nullable; cover-image filename under `IMG_DIR`       |
| url         | TEXT             | nullable                                             |
| source_uid  | TEXT             | nullable; `.ics` UID, used for import de-duplication |
| created_at  | TEXT NOT NULL    |                                                      |
| updated_at  | TEXT NOT NULL    |                                                      |

Indexes: `idx_events_calendar(calendar_id)`, `idx_events_start(start_at)`,
`idx_events_source_uid(source_uid)`.

The `image_path`, `url`, and `source_uid` columns are added by an idempotent
migration in `openDb` (`ALTER TABLE … ADD COLUMN` when missing), so databases
created before these fields existed are upgraded in place on the next boot.

**reminders**

| Column         | Type             | Notes                             |
| -------------- | ---------------- | --------------------------------- |
| id             | TEXT PK          | uuid                              |
| event_id       | TEXT NOT NULL    | FK → events(id) ON DELETE CASCADE |
| minutes_before | INTEGER NOT NULL | offset before event start         |
| method         | TEXT NOT NULL    | default `notification`            |

Index: `idx_reminders_event(event_id)`.

**tags**

| Column | Type                 | Notes           |
| ------ | -------------------- | --------------- |
| id     | TEXT PK              | uuid            |
| name   | TEXT NOT NULL UNIQUE | duplicate → 409 |
| color  | TEXT                 | nullable        |

**event_tags** (many-to-many join)

| Column   | Type          | Notes                             |
| -------- | ------------- | --------------------------------- |
| event_id | TEXT NOT NULL | FK → events(id) ON DELETE CASCADE |
| tag_id   | TEXT NOT NULL | FK → tags(id) ON DELETE CASCADE   |
|          |               | PRIMARY KEY (event_id, tag_id)    |

**api_keys**

| Column       | Type                 | Notes                                      |
| ------------ | -------------------- | ------------------------------------------ |
| id           | TEXT PK              | uuid                                       |
| name         | TEXT                 | label, nullable                            |
| key_hash     | TEXT NOT NULL UNIQUE | SHA-256 hex of the raw key                 |
| scope        | TEXT NOT NULL        | CHECK in ('read','write'), default 'write' |
| created_at   | TEXT NOT NULL        |                                            |
| last_used_at | TEXT                 | nullable; updated on each auth             |
| revoked      | INTEGER NOT NULL     | 0/1, default 0                             |

### 3.2 Relationships

- **Calendar 1—N Event**: an event belongs to exactly one calendar; deleting a
  calendar cascades to its events (and their reminders / tag links).
- **Event 1—N Reminder**: stored metadata; cascade on event delete.
- **Event N—N Tag** via `event_tags`: a tag can mark events across calendars.

### 3.3 API representations

The DB row shapes differ from the JSON returned by the API. Services hydrate
rows into domain objects:

```jsonc
// Calendar
{ "id", "name", "color": string|null, "description": string|null,
  "created_at", "updated_at" }

// Event  (all_day is a boolean; tags are names; reminders embedded)
{ "id", "calendar_id", "title",
  "description": string|null, "location": string|null,
  "start_at", "end_at", "all_day": boolean,
  "image_path": string|null,   // cover-image filename; fetch via GET /api/img/{name}
  "url": string|null,
  "source_uid": string|null,   // set only for .ics-imported events
  "created_at", "updated_at",
  "tags": string[],            // tag names attached to the event
  "reminders": Reminder[] }

// Reminder
{ "id", "event_id", "minutes_before": number, "method": string }

// Tag
{ "id", "name", "color": string|null }
```

---

## 4. Validation rules

Validation uses shared Zod schemas (REST request bodies, OpenAPI generation, and
MCP tool input schemas all derive from the same definitions). Cross-field /
referential rules live in the service so both surfaces enforce them.

| Input           | Rules                                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create calendar | `name` required (min length 1); `color`, `description` optional                                                                                                                                                         |
| Update calendar | all fields optional; `color`/`description` may be set to null                                                                                                                                                           |
| Create event    | `calendar_id`, `title`, `start_at`, `end_at` required; `all_day` defaults false; `description`, `location`, `url`, `image_path` optional; **referenced calendar must exist** (→ 404); **`end_at` ≥ `start_at`** (→ 400) |
| Update event    | all fields optional (incl. `url`/`image_path`, which may be set to null); same referential + ordering checks when the affected fields are present                                                                       |
| Event query     | `calendarId?`, `from?`, `to?`, `tag?`, `q?`, `limit` (1–500, default 50), `offset` (≥ 0, default 0)                                                                                                                     |
| Create reminder | `minutes_before` integer ≥ 0; `method` defaults `notification`                                                                                                                                                          |
| Create tag      | `name` required and unique (duplicate → 409)                                                                                                                                                                            |
| Update tag      | all fields optional; renaming to an existing name → 409                                                                                                                                                                 |
| Image upload    | multipart `file` must be `image/jpeg\|png\|webp\|gif` and ≤ 5 MB; stored as `<uuid>.<ext>` under `IMG_DIR`                                                                                                              |
| `.ics` import   | multipart `file` (≤ 10 MB) + `calendar_id` (must exist → 404); recurring (`RRULE`) and already-imported (`source_uid`) events are skipped                                                                               |

**Date format**: any string that `Date.parse` accepts (full ISO timestamps and
date-only values). Stored verbatim.

**Event list filters** (`GET /api/events` and the `list_events` tool):

- `calendarId` — restrict to one calendar.
- `from` / `to` — inclusive bounds on `start_at`.
- `tag` — only events carrying a tag with this **name**.
- `q` — case-insensitive `LIKE` match on `title` or `description`.
- `limit` / `offset` — pagination, ordered by `start_at` ascending.

---

## 5. Authentication & authorization

### 5.1 API keys

- Format: `cal_<base64url(32 random bytes)>`.
- Only the **SHA-256 hash** is stored (`api_keys.key_hash`). The raw key is shown
  exactly once at creation.
- Each key has a **scope**: `read` or `write`. Multiple keys may exist (e.g. one
  per client), each independently revocable.
- On every successful authentication the key's `last_used_at` is updated.

### 5.2 Credential transport

For the **REST/SSE HTTP server**, the key may be supplied as (checked in this
order):

1. `Authorization: Bearer <key>`
2. `Authorization: <key>` — a bare value without the `Bearer` prefix is also
   accepted.
3. `X-API-Key: <key>`
4. `yot_session` HttpOnly cookie — set by the PIN pairing flow (§5.5).
5. `?key=<key>` query parameter — for browser `EventSource`, which cannot set
   headers.

The same extraction applies to every authenticated route, so `?key=` works on
any `/api/*` endpoint, not just the SSE feed.

The **stdio MCP server** has no HTTP request, so it reads the key once from the
`YOT_API_KEY` environment variable at startup (§5.4).

### 5.3 Enforcement

- **Missing / invalid / revoked key** → `401 unauthorized` (the response carries
  a `WWW-Authenticate: Bearer realm="yot"` header).
- **REST mutation with a `read` key** (any non-GET/HEAD/OPTIONS method) →
  `403 forbidden`.
- **MCP write tool with a `read` key** → tool result with `isError: true` and
  message "This API key is read-only".

### 5.4 MCP scope (stdio)

The stdio MCP server is authenticated by default. At startup it reads
`YOT_API_KEY` and resolves it against the key store: an unknown/revoked key (or a
missing variable) aborts the process with an error on stderr and a non-zero exit;
a valid key fixes the connection's scope (`read` or `write`) for its lifetime and
updates `last_used_at`. Setting `MCP_AUTH=off` (or `false`/`0`/`no`) skips the
key lookup entirely and runs every tool with full `write` scope. The REST API is
a separate process and stays protected regardless of this setting.

### 5.5 PIN pairing (browser sessions)

The web UI authenticates via a short-lived PIN flow rather than requiring users
to paste API keys:

1. An authenticated client (e.g. `scripts/auth.ts`) calls `POST /api/auth/pin`
   with a desired scope. The server mints a random 6-digit PIN bound to that
   scope, stored hashed in the `PairingService` (in-memory, 5-minute TTL).
2. The browser submits the PIN to `POST /api/auth/pair` (public, no auth
   required). If the PIN is valid and unexpired, the server creates a new API
   key (`web` label), sets it as an `HttpOnly`, `SameSite=Strict`,
   `Secure` (when HTTPS) cookie named `yot_session`, and returns the scope.
3. Subsequent browser requests carry the cookie automatically. The auth
   middleware reads `yot_session` in the credential extraction chain (§5.2).
4. `POST /api/auth/logout` revokes the underlying API key and clears the cookie.
5. `GET /api/auth/session` (authed) returns the current scope for the session.

PINs are one-time-use and stored hashed (SHA-256) in process memory — they are
never persisted to the database. A `RateLimiter` blocks an IP after 5 failed
pairing attempts within 60 seconds.

No escalation: a `read`-scoped key can only mint `read` PINs, even if `write`
is requested.

---

## 6. REST API

Base path `/api`. Interactive docs at `/api/ui`; raw OpenAPI 3.0 at `/api/doc`
(title "Calendar API", version "1.0.0").

### 6.1 Endpoints

| Method | Path                           | Auth   | Body           | Success                          |
| ------ | ------------------------------ | ------ | -------------- | -------------------------------- |
| GET    | `/health`                      | public | —              | 200 `{ "status": "ok" }`         |
| GET    | `/doc`                         | public | —              | 200 OpenAPI JSON                 |
| GET    | `/ui`                          | public | —              | 200 Swagger UI (HTML)            |
| POST   | `/auth/pair`                   | public | `{ pin }`      | 200 + Set-Cookie                 |
| POST   | `/auth/logout`                 | public | —              | 200 + Clear-Cookie               |
| POST   | `/auth/pin`                    | authed | `{ scope? }`   | 200 `{ pin, scope, expires_in }` |
| GET    | `/auth/session`                | authed | —              | 200 `{ scope }`                  |
| GET    | `/stream`                      | read   | —              | 200 `text/event-stream`          |
| GET    | `/calendars`                   | read   | —              | 200 `Calendar[]`                 |
| POST   | `/calendars`                   | write  | CreateCalendar | 201 `Calendar`                   |
| GET    | `/calendars/{id}`              | read   | —              | 200 `Calendar`                   |
| PATCH  | `/calendars/{id}`              | write  | UpdateCalendar | 200 `Calendar`                   |
| DELETE | `/calendars/{id}`              | write  | —              | 204                              |
| GET    | `/events`                      | read   | query filters  | 200 `Event[]`                    |
| POST   | `/events`                      | write  | CreateEvent    | 201 `Event`                      |
| GET    | `/events/{id}`                 | read   | —              | 200 `Event`                      |
| PATCH  | `/events/{id}`                 | write  | UpdateEvent    | 200 `Event`                      |
| DELETE | `/events/{id}`                 | write  | —              | 204                              |
| POST   | `/events/{id}/reminders`       | write  | CreateReminder | 201 `Reminder`                   |
| DELETE | `/events/{id}/reminders/{rid}` | write  | —              | 204                              |
| POST   | `/events/{id}/tags/{tagId}`    | write  | —              | 200 `Event`                      |
| DELETE | `/events/{id}/tags/{tagId}`    | write  | —              | 200 `Event`                      |
| POST   | `/events/import`               | write  | multipart †    | 200 `ImportSummary`              |
| POST   | `/uploads/image`               | write  | multipart †    | 201 `{ path }`                   |
| POST   | `/uploads/image-from-url`      | write  | `{ url }`      | 201 `{ path }`                   |
| GET    | `/img/{file}`                  | read   | —              | 200 image bytes (or 404)         |
| GET    | `/tags`                        | read   | —              | 200 `Tag[]`                      |
| POST   | `/tags`                        | write  | CreateTag      | 201 `Tag`                        |
| PATCH  | `/tags/{id}`                   | write  | UpdateTag      | 200 `Tag`                        |
| DELETE | `/tags/{id}`                   | write  | —              | 204                              |

† The upload and `.ics` import routes take `multipart/form-data` (and the
`image-from-url` route a raw JSON body), so they are plain Hono routes rather
than `@hono/zod-openapi` routes — they sit behind the same auth gate but do
**not** appear in the generated OpenAPI document at `/api/doc`. `GET /img/{file}`
returns the stored bytes with a long-lived immutable `Cache-Control`.

Also at the server root: `GET /` serves the web console (§9). The MCP server is
a separate stdio process, not an HTTP endpoint (§8).

### 6.2 Errors

Single error envelope, emitted by the `onError` handler:

```json
{ "error": { "code": "string", "message": "string", "details": "optional" } }
```

| Status | code               | When                                                                                                       |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| 400    | `validation_error` | Zod request validation fails (`details` = issues) or `end_at` < `start_at`                                 |
| 401    | `unauthorized`     | missing/invalid/revoked key                                                                                |
| 403    | `forbidden`        | read-scoped key attempts a mutation                                                                        |
| 404    | `not_found`        | calendar/event/tag/reminder id does not exist                                                              |
| 409    | `conflict`         | tag name already exists                                                                                    |
| 429    | `rate_limited`     | too many failed `POST /auth/pair` attempts from one IP (returned directly by the route, not via `onError`) |
| 500    | `internal_error`   | unexpected error (logged server-side)                                                                      |

### 6.3 Example

```bash
KEY=cal_xxx
# create a calendar
curl -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"name":"Work","color":"#3b82f6"}' http://localhost:4010/api/calendars
# create an event in it
curl -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"calendar_id":"<id>","title":"Standup",
       "start_at":"2026-05-30T09:00:00Z","end_at":"2026-05-30T09:30:00Z"}' \
  http://localhost:4010/api/events
# filtered list
curl -H "Authorization: Bearer $KEY" \
  "http://localhost:4010/api/events?calendarId=<id>&from=2026-05-01T00:00:00Z&q=stand"
```

### 6.4 Cover images

`ImageService` owns a single local directory (`IMG_DIR`, default `data/img`).
Files are named `<uuid>.<ext>` where `ext` is constrained to `jpg`/`png`/`webp`/`gif`,
and every read/serve path validates the name against that pattern (no traversal).

- `POST /api/uploads/image` — `multipart/form-data` with a `file` field. Validates
  the MIME type and a 5 MB cap, writes the bytes, returns `{ "path": "<uuid>.<ext>" }`.
- `POST /api/uploads/image-from-url` — JSON `{ url }`. Fetches a remote image into
  `IMG_DIR` after an **SSRF guard**: the URL must be `http(s)`, must not resolve to
  a loopback/private/link-local address, and redirects are refused (`redirect: "error"`).
  Same MIME/size limits apply.
- `GET /api/img/{file}` — serves the stored bytes with the right `Content-Type`
  and an immutable one-year `Cache-Control`; unknown/invalid names return `404`.

Set an event's `image_path` to a returned filename to attach it. Replacing or
clearing `image_path` (on update) or deleting the event removes the old file
best-effort.

### 6.5 Calendar (.ics) import

`POST /api/events/import` — `multipart/form-data` with a `file` (an iCalendar
document, ≤ 10 MB) and a `calendar_id` (must already exist → `404`). Parsed with
`ical.js`. Each `VEVENT` becomes a one-off event in the target calendar; the
response is an `ImportSummary`:

```jsonc
{ "created": number,
  "skippedRecurring": number,   // VEVENTs carrying an RRULE (recurrence is out of scope)
  "skippedDuplicate": number,   // UID already present as an event's source_uid
  "errors": string[] }          // per-VEVENT parse/validation messages
```

Each imported event stores the source `UID` in `source_uid`, so re-importing the
same file is idempotent. `ical.js` 2.x ships no timezone database: a `DTSTART`
with a `TZID` but no inline `VTIMEZONE` is treated as floating and converted using
the server's local offset (well-behaved exporters embed `VTIMEZONE`).

---

## 7. Realtime (SSE)

`GET /api/stream` (auth required; `?key=` accepted). Response is
`text/event-stream`. On connect the server sends a `ready` frame, then forwards
every change-bus event, then a periodic `ping` (~25 s) to keep the connection
alive. The connection stays open until the client disconnects.

Frame format — the SSE `event:` name is the change type, `data:` is JSON:

```
event: event.created
data: {"id":"...","title":"Standup", ...}
```

| Event name                              | data payload       |
| --------------------------------------- | ------------------ |
| `ready`                                 | `"connected"`      |
| `ping`                                  | timestamp (ms)     |
| `calendar.created` / `calendar.updated` | the Calendar       |
| `calendar.deleted`                      | `{ "id" }`         |
| `event.created` / `event.updated`       | the hydrated Event |
| `event.deleted`                         | `{ "id" }`         |
| `tag.created` / `tag.updated`           | the Tag            |
| `tag.deleted`                           | `{ "id" }`         |

Note: reminder and tag-link changes are emitted as `event.updated` carrying the
full refreshed event (clients just re-render the event).

---

## 8. MCP

A **stdio** server (`src/mcp/stdio.ts`), spawned by the MCP client and speaking
JSON-RPC over stdin/stdout — no HTTP. Server identity: `yot-calendar` v1.0.0.
Authenticated by default (§5.4): the `McpServer` is built once at startup with
the scope resolved from `YOT_API_KEY` (or full `write` when `MCP_AUTH=off`). Tool
input schemas are the same Zod schemas as REST. Service errors are returned as
`{ isError: true }` text results. Because the process writes JSON-RPC on stdout,
it emits no startup banner there; diagnostics go to stderr.

The MCP surface covers core calendar/event/tag CRUD only. Image upload, `.ics`
import, tag update, and reminder deletion are REST-only (no equivalent tool); an
agent can still set an event's `image_path`/`url` via `create_event`/`update_event`.

### 8.1 Tools (14)

| Tool              | Scope | Input                                                                                      |
| ----------------- | ----- | ------------------------------------------------------------------------------------------ |
| `list_calendars`  | read  | —                                                                                          |
| `create_calendar` | write | name, color?, description?                                                                 |
| `update_calendar` | write | id, name?, color?, description?                                                            |
| `delete_calendar` | write | id                                                                                         |
| `list_events`     | read  | calendarId?, from?, to?, tag?, q?, limit?, offset?                                         |
| `get_event`       | read  | id                                                                                         |
| `create_event`    | write | calendar_id, title, start_at, end_at, description?, location?, all_day?, url?, image_path? |
| `update_event`    | write | id, + any event fields                                                                     |
| `delete_event`    | write | id                                                                                         |
| `add_reminder`    | write | event_id, minutes_before, method?                                                          |
| `list_tags`       | read  | —                                                                                          |
| `create_tag`      | write | name, color?                                                                               |
| `tag_event`       | write | event_id, tag_id                                                                           |
| `untag_event`     | write | event_id, tag_id                                                                           |

### 8.2 Client configuration

A local `.mcp.json` (gitignored) launches the `yot` server as a child process and
passes the key through its environment:

```json
{
  "mcpServers": {
    "yot": {
      "command": "npx",
      "args": ["tsx", "src/mcp/stdio.ts"],
      "env": { "YOT_API_KEY": "cal_..." }
    }
  }
}
```

The key's scope (`read`/`write`) governs which tools succeed. To run without a
key, set `"env": { "MCP_AUTH": "off" }` instead (full `write`, no auth). For a
compiled deployment, point `command`/`args` at `node dist/mcp/stdio.js`
(`npm run mcp:start`). The client spawns the process locally, so only the
same-machine agent can reach it.

### 8.3 SSE relay

The MCP process runs a **change relay** (`src/mcp/relay.ts`) that forwards every
bus event to the HTTP server via `POST /api/internal/events`, authenticated with
`YOT_API_KEY`. This bridges the two in-memory buses so MCP mutations appear on
the SSE feed almost instantly. The relay is fire-and-forget (a failed POST is
logged to stderr but does not affect the tool result). It is enabled by default
when `YOT_API_KEY` is set and `YOT_SSE_RELAY` is not disabled. See §10 for the
relay-specific environment variables.

---

## 9. Web UI

`GET /` serves the Vue 3 SPA built from `web/` (production: static files from
`web/dist` with SPA fallback; development: Vite dev server on port 5173 proxying
`/api` to the backend). Styling is Tailwind CSS v4 with **DaisyUI**; the app is
an installable **PWA** (`vite-plugin-pwa`, auto-updating service worker).

Routes (`web/src/router.ts`):
- **PIN pairing** (`/pair`) — enter a 6-digit PIN from `npm run auth` to
  establish the session cookie.
- **Calendar** (`/`) — on desktop a Schedule-X v2 month/week/day grid (lazily
  loaded so its engine ships only to desktop visitors); on mobile a lighter
  custom month/week grid (`MobileCalendar`).
- **List** (`/list`) — searchable agenda list.
- **Cover** (`/cover`) — the same view in an editorial cover-image mosaic
  (`CoverGrid`); both live in `ListView`.

Cross-cutting UI:
- **Event modal** — create / view / edit, including Markdown descriptions
  (`markdown-it`, rendered safely), tag attach/detach, cover-image upload (file
  or from URL), URL, location, and all-day toggle.
- **Sidebar / filter sheet** — calendar management (create, rename, recolor) and
  tag management (create, rename, recolor, delete), per-calendar visibility
  toggles, single-tag filter, and an SSE connection indicator. The sidebar docks
  on desktop; on mobile the same controls live in a bottom sheet.
- **`.ics` import dialog** — pick a calendar and upload a file, then show the
  `ImportSummary`.
- **Theme toggle** — light / dark / system, persisted to `localStorage`; maps to
  the DaisyUI `emerald` (light) and `forest` (dark) palettes.
- **Bottom dock** (mobile) — navigation plus a "+ New" composer trigger.
- **Live updates** — `useSSE` subscribes to `/api/stream`, reconnects on error,
  and reloads only the resource slice that changed (calendars / events / tags),
  coalescing the post-mutation refetch with the SSE broadcast it triggers.
- **Auth guard** — the session is validated once (`GET /api/auth/session`) then
  cached; a later `401` clears the cache and the next navigation routes to
  `/pair`.

The frontend is an independent Vite project (`web/package.json`) with its own
dependencies. It uses `@` (→ `web/src`) and `@yot/schemas` (→ backend `src/schemas`)
path aliases. Types for API responses are defined in the API client
(`web/src/api/client.ts`).

---

## 10. Configuration

Environment variables (loaded from `.env` at startup if present; real environment
variables take precedence):

| Variable        | Default                            | Purpose                                                               |
| --------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `PORT`          | `4010`                             | HTTP listen port (REST/SSE/web)                                       |
| `DB_PATH`       | `data.db`                          | SQLite file (`:memory:` in tests); shared by both processes           |
| `IMG_DIR`       | `data/img`                         | directory for stored cover images (read at service-construction time) |
| `MCP_AUTH`      | `on`                               | `off`/`false`/`0`/`no` runs the stdio MCP server with full write      |
| `YOT_API_KEY`   | —                                  | key the stdio MCP server resolves to a scope at startup (§5.4)        |
| `YOT_HTTP_URL`  | `http://127.0.0.1:${PORT ?? 4010}` | Base URL of the HTTP server; relay POSTs to `…/api/internal/events`   |
| `YOT_SSE_RELAY` | `on`                               | `off`/`false`/`0`/`no` force-disables the MCP→SSE relay               |

Both `.env` and `.mcp.json` are gitignored (they hold or can hold the raw key).

### 10.1 NPM scripts

Run the backend and frontend dev servers in separate terminals (`npm run dev`
and `npm run web:dev`); there is no combined script.

| Script              | Action                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`       | `tsx watch src/index.ts` (HTTP server: REST/SSE/web)                         |
| `npm run web:dev`   | `vite` dev server (port 5173, proxies `/api`)                                |
| `npm run web:build` | `vue-tsc --noEmit && vite build` → `web/dist/`                               |
| `npm run build`     | `tsc` → `dist/` then `web` build → `web/dist/`                               |
| `npm start`         | `node dist/index.js` (HTTP server, serves SPA)                               |
| `npm run mcp`       | `tsx src/mcp/stdio.ts` (stdio MCP server)                                    |
| `npm run mcp:start` | `node dist/mcp/stdio.js` (stdio MCP server, built)                           |
| `npm run auth`      | mint a PIN to pair a browser session                                         |
| `npm run init`      | create an API key, save it to `.env`, set MCP auth (`init.ts`)               |
| `npm run config`    | edit `PORT` / `DB_PATH` / `MCP_AUTH` in `.env` + list/create/revoke API keys |
| `npm test`          | `tsx --test "src/**/*.test.ts"` (node:test suites)                           |
| `npm run format`    | `biome check --write .`                                                      |

---

## 11. Testing

`npm test` runs `node:test` through `tsx` over `src/**/*.test.ts` (backend only;
the web project's `web/test/*` is not part of this run). Services are tested
against an in-memory SQLite database; the REST layer is tested via Hono's
`app.request()`.

Coverage:

- `core/event-bus.test.ts` — subscribe/emit/unsubscribe.
- `db/connection.test.ts` — pragmas, schema apply, and the idempotent
  add-missing-column migration.
- `services/*.test.ts` — calendar/event/tag CRUD, validation (end ≥ start,
  missing FK), tag/reminder linking, and `list` filters (calendar, date range,
  tag, search, pagination); each mutation asserts the expected change event.
- `services/image.service.test.ts` — name validation/traversal guard, MIME and
  size limits, and the SSRF guard (`isPrivateHost`, redirect refusal).
- `services/import.service.test.ts` — `.ics` parsing, recurring/duplicate skips,
  all-day detection, and the `ImportSummary` shape.
- `auth/apikey.test.ts` — generate/hash/lookup roundtrip, revoked rejected,
  `last_used_at` updates, hash never exposed.
- `auth/pairing.test.ts` — PIN create/redeem, one-time use, TTL expiry.
- `auth/rate-limit.test.ts` — block after max failures, window expiry, reset.
- `rest/app.test.ts` — health (public), 401 (no key), 403 (read-only mutation),
  full calendar+event CRUD flow, 400 (bad dates), 404 (unknown), OpenAPI doc.
- `rest/auth.test.ts` — PIN minting, pairing with cookie, cookie-based auth,
  scope downgrade for read keys.
- `rest/uploads.test.ts` — image upload/serve, type/size rejection, auth gating.
- `rest/import.test.ts` — multipart `.ics` import end-to-end (created/skipped counts).
- `rest/internal.test.ts` — relay uplink replays a change onto the bus; bad
  bodies rejected.
- `rest/stream.test.ts` — SSE smoke test: `ready` frame then a broadcast after a
  mutation.
- `mcp/relay.test.ts` — bus events are POSTed to the configured URL with the key;
  failures are swallowed.

---

## 12. Security considerations

- Keys are stored only as SHA-256 hashes; raw keys are shown once.
- The `?key=` query option is convenient but can leak into logs/history; prefer
  the header where the client supports it.
- Pairing PINs are 6-digit, one-time-use, hashed in memory (never persisted),
  and expire after 5 minutes. A per-IP rate limiter blocks after 5 failed
  attempts within 60 seconds.
- The `yot_session` cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` when
  served over HTTPS. It contains a full API key (not a session token), so
  revoking the key invalidates the session.
- `MCP_AUTH=off` removes all scope control on the stdio MCP server (every tool
  runs as `write`) — use only on a trusted local machine. Since the client spawns
  the process locally and `YOT_API_KEY` is passed through its environment, this
  selects scope rather than gating network access.
- CORS is permissive (any origin); the API key is the gate. Tighten the CORS
  policy before exposing the server beyond localhost.
- The server binds to localhost; remote exposure requires an explicit tunnel and
  should be paired with stricter CORS and header-based auth.
- `POST /api/internal/events` lets an authenticated write-key holder inject
  arbitrary change frames to all SSE clients. Acceptable for a localhost
  single-user tool; it is auth-gated and requires a write-scoped key.
- `POST /api/uploads/image-from-url` is SSRF-guarded: the URL must be `http(s)`,
  must not resolve to a loopback/private/link-local address, and redirects are
  refused. DNS resolution and the subsequent `fetch` are independent, so a
  narrow TOCTOU/rebinding window remains — acceptable for a single-user
  self-hosted app. Stored image names are constrained to `<uuid>.<ext>`, so the
  serve path cannot be coerced into directory traversal.

---

## 13. Future extension points

- **Recurring events**: store an RRULE, expand occurrences over a query range,
  and support per-occurrence overrides (EXDATE / modified instances).
- **Reminder delivery**: a scheduler that fires due reminders as an SSE event
  (e.g. `reminder.due`) or via push.
- **Multi-user**: scope data per key/owner and add sharing.
- **Granular SSE**: per-calendar channels or `Last-Event-ID` resume.
- **Key management API/UI**: list/revoke keys at runtime.
```
