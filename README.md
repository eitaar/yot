# yot — Calendar backend

A single-user calendar backend where **both a REST API and an MCP server** perform
full CRUD over the same data, with **Server-Sent Events** for realtime sync and
**API-key authentication**.

- **REST API** — [Hono](https://hono.dev) + `@hono/zod-openapi` (auto-generated OpenAPI docs)
- **Database** — `better-sqlite3` (WAL, foreign keys on)
- **MCP** — the same operations exposed as tools at `/mcp`
- **Realtime** — one global SSE change feed at `/api/stream`
- **Auth** — opaque API keys with `read` / `write` scopes (only SHA-256 hashes stored)

## Setup

```bash
npm install
npm run init     # create your first API key (shown once — copy it)
npm run dev      # start the server on http://localhost:3000
```

Environment variables: `PORT` (default `3000`), `DB_PATH` (default `data.db`).

Build & run the compiled server:

```bash
npm run build && npm start
```

## Authentication

Every `/api/*` and `/mcp` request needs a key. Send it as a header:

```
Authorization: Bearer cal_xxxxxxxx
```

`X-API-Key: cal_xxxx` is also accepted, and the SSE endpoint additionally accepts
`?key=cal_xxxx` (for browser `EventSource`, which can't set headers).

Scopes: `read` keys may only perform GET requests / read-only tools; `write` keys
may do everything. Mutating with a `read` key returns `403`.

## Data model

```
calendars ──< events ──< reminders
                  └──< event_tags >── tags
```

- **Calendar** — `name`, `color`, `description`
- **Event** — belongs to a calendar; `title`, `description`, `location`,
  `start_at`, `end_at`, `all_day`; carries `tags` (names) and `reminders`
- **Reminder** — `minutes_before`, `method` (stored metadata; the server does not fire them)
- **Tag** — unique `name`, `color`; linked to events many-to-many

Timestamps are ISO-8601 UTC strings. Recurring events are intentionally out of scope.

## REST API

Base path `/api`. Interactive docs at **`/api/ui`**; raw OpenAPI at **`/api/doc`**.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | public, no auth |
| `GET` `POST` | `/calendars` | list / create |
| `GET` `PATCH` `DELETE` | `/calendars/{id}` | |
| `GET` `POST` | `/events` | list supports `?calendarId=&from=&to=&tag=&q=&limit=&offset=` |
| `GET` `PATCH` `DELETE` | `/events/{id}` | |
| `POST` | `/events/{id}/reminders` | |
| `DELETE` | `/events/{id}/reminders/{rid}` | |
| `POST` `DELETE` | `/events/{id}/tags/{tagId}` | attach / detach a tag |
| `GET` `POST` | `/tags` | |
| `DELETE` | `/tags/{id}` | |
| `GET` | `/stream` | SSE feed |

Errors return `{ "error": { "code", "message", "details?" } }` with the matching
status (`400` validation, `401` unauthenticated, `403` read-only, `404` not found,
`409` duplicate tag name).

Example:

```bash
KEY=cal_xxxx
curl -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"name":"Work","color":"#3b82f6"}' http://localhost:3000/api/calendars
```

## Realtime (SSE)

```bash
curl -N "http://localhost:3000/api/stream?key=$KEY"
```

Each change — whether made over REST **or** MCP — is broadcast as an SSE frame
whose event name is the change type and whose data is JSON:

```
event: event.created
data: {"id":"...","title":"Sync", ...}
```

Types: `calendar.created|updated|deleted`, `event.created|updated|deleted`,
`tag.created|deleted`. A `ping` event is sent periodically to keep idle
connections alive.

## MCP

The MCP server is mounted at `/mcp` (Streamable HTTP) and is configured in
`.mcp.json`. It authenticates with the same API keys and exposes the same CRUD as
tools: `list_calendars`, `create_calendar`, `update_calendar`, `delete_calendar`,
`list_events`, `get_event`, `create_event`, `update_event`, `delete_event`,
`add_reminder`, `list_tags`, `create_tag`, `tag_event`, `untag_event`. Write tools
return an error result for read-only keys.

## Architecture

A **shared service layer** (`src/services/`) owns all DB access and business rules.
REST routes (`src/rest/`) and MCP tools (`src/mcp/`) are thin adapters over it. Every
successful mutation emits a change event on an in-process **event bus**
(`src/core/event-bus.ts`); the SSE endpoint subscribes and forwards to clients — which
is why a change through any surface appears on the feed.

```
request → auth middleware → REST route / MCP tool → service → SQLite
                                                       └→ event bus → SSE clients
```

## Tests

```bash
npm test     # node:test via tsx — services, auth, event bus, REST + SSE integration
npm run format
```
