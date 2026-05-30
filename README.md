# yot — Calendar backend

A single-user calendar backend where **both a REST API and an MCP server** perform
full CRUD over the same data, with **Server-Sent Events** for realtime sync and
**API-key authentication**. A **Vue 3 SPA** provides a browser-based calendar UI.

- **Web UI** — Vue 3 + Vite + Tailwind CSS + Schedule-X calendar
- **REST API** — [Hono](https://hono.dev) + `@hono/zod-openapi` (auto-generated OpenAPI docs)
- **Database** — `better-sqlite3` (WAL, foreign keys on)
- **MCP** — the same operations exposed as tools over a **stdio** server
- **Realtime** — one global SSE change feed at `/api/stream`
- **Auth** — opaque API keys with `read` / `write` scopes; browser sessions via PIN pairing

## Setup

```bash
npm install
cd web && npm install && cd ..
npm run init     # create your first API key (shown once — copy it), saved to .env
npm run dev:all  # start backend + frontend dev servers
```

Open `http://localhost:5173` (Vite dev server, proxies `/api` to the backend).
On first visit you'll be redirected to `/pair`. In another terminal:

```bash
npm run auth     # interactive: choose scope, get a 6-digit PIN
```

Enter the PIN in the browser to pair.

Environment variables: `PORT` (default `4010`), `DB_PATH` (default `data.db`),
`MCP_AUTH` (default `on`), `YOT_HTTP_URL` (default `http://127.0.0.1:$PORT`),
`YOT_SSE_RELAY` (default `on`). Run `npm run config` for an interactive `.env`
editor.

Build & run the compiled server (serves the SPA at `/`):

```bash
npm run build && npm start   # http://localhost:4010
```

## Authentication

### API keys (programmatic clients)

Every `/api/*` request needs a key. Send it as a header:

```
Authorization: Bearer cal_xxxxxxxx
```

`X-API-Key: cal_xxxx` is also accepted, as is a bare `Authorization: cal_xxxx`
(without the `Bearer` prefix). Every authenticated route also accepts the key as
a `?key=cal_xxxx` query parameter — handy for browser `EventSource` (which can't
set headers). The stdio MCP server takes its key from the `YOT_API_KEY`
environment variable instead (see [MCP](#mcp)).

Scopes: `read` keys may only perform GET requests / read-only tools; `write` keys
may do everything. Mutating with a `read` key returns `403` (REST) or an error
tool result (MCP).

### PIN pairing (browser)

The web UI authenticates via a short-lived PIN flow:

1. Run `npm run auth` — it calls `POST /api/auth/pin` (authenticated) to mint a
   one-time 6-digit PIN.
2. Enter the PIN in the browser at `/pair` — `POST /api/auth/pair` (public)
   redeems it and sets an `HttpOnly` `yot_session` cookie containing a fresh API
   key.
3. Subsequent requests use the cookie automatically. `POST /api/auth/logout`
   revokes the key and clears the cookie.

PINs expire after 5 minutes and are stored hashed in memory (never persisted).
A rate limiter blocks an IP after 5 failed pairing attempts.

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

| Method                 | Path                           | Notes                                                         |
| ---------------------- | ------------------------------ | ------------------------------------------------------------- |
| `GET`                  | `/health`                      | public, no auth                                               |
| `POST`                 | `/auth/pair`                   | public — redeem PIN, set session cookie                       |
| `POST`                 | `/auth/logout`                 | public — revoke session, clear cookie                         |
| `POST`                 | `/auth/pin`                    | authed — mint a pairing PIN                                   |
| `GET`                  | `/auth/session`                | authed — check current session scope                          |
| `GET` `POST`           | `/calendars`                   | list / create                                                 |
| `GET` `PATCH` `DELETE` | `/calendars/{id}`              |                                                               |
| `GET` `POST`           | `/events`                      | list supports `?calendarId=&from=&to=&tag=&q=&limit=&offset=` |
| `GET` `PATCH` `DELETE` | `/events/{id}`                 |                                                               |
| `POST`                 | `/events/{id}/reminders`       |                                                               |
| `DELETE`               | `/events/{id}/reminders/{rid}` |                                                               |
| `POST` `DELETE`        | `/events/{id}/tags/{tagId}`    | attach / detach a tag                                         |
| `GET` `POST`           | `/tags`                        |                                                               |
| `DELETE`               | `/tags/{id}`                   |                                                               |
| `GET`                  | `/stream`                      | SSE feed                                                      |

Errors return `{ "error": { "code", "message", "details?" } }` with the matching
status (`400` validation, `401` unauthenticated, `403` read-only, `404` not found,
`409` duplicate tag name).

Example:

```bash
KEY=cal_xxxx
curl -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"name":"Work","color":"#3b82f6"}' http://localhost:4010/api/calendars
```

## Realtime (SSE)

```bash
curl -N "http://localhost:4010/api/stream?key=$KEY"
```

Each change — whether made over REST or MCP (via the relay) — is broadcast as an
SSE frame whose event name is the change type and whose data is JSON:

```
event: event.created
data: {"id":"...","title":"Sync", ...}
```

Types: `calendar.created|updated|deleted`, `event.created|updated|deleted`,
`tag.created|deleted`. A `ping` event is sent periodically to keep idle
connections alive.

## MCP

The MCP server runs over **stdio** (`src/mcp/stdio.ts`): the MCP client spawns it
and talks JSON-RPC over stdin/stdout — there is no HTTP endpoint. Configure it in
`.mcp.json`, passing the API key through the process environment:

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

The key's scope (`read`/`write`) is resolved once at startup. To skip auth and
run every tool with full `write`, set `"env": { "MCP_AUTH": "off" }` instead. For
a compiled deployment, point at `node dist/mcp/stdio.js` (`npm run mcp:start`);
run it directly during development with `npm run mcp`.

It exposes the same CRUD as tools: `list_calendars`, `create_calendar`,
`update_calendar`, `delete_calendar`, `list_events`, `get_event`, `create_event`,
`update_event`, `delete_event`, `add_reminder`, `list_tags`, `create_tag`,
`tag_event`, `untag_event`. Write tools return an error result for read-only keys.

> The stdio MCP server is a **separate process** with its own in-memory event
> bus. A built-in **relay** bridges the gap: each MCP mutation is POSTed to the
> HTTP server's internal endpoint, which replays it onto the SSE feed. This is
> automatic when `YOT_API_KEY` is set (the key must be write-scoped). Disable
> with `YOT_SSE_RELAY=off`.

## Architecture

A **shared service layer** (`src/services/`) owns all DB access and business rules.
REST routes (`src/rest/`) and MCP tools (`src/mcp/`) are thin adapters over it. Every
successful mutation emits a change event on an in-process **event bus**
(`src/core/event-bus.ts`); the HTTP server's SSE endpoint subscribes and forwards to
clients — which is why a REST change appears on the feed. The HTTP server
(REST/SSE/web) and the stdio MCP server are **separate processes** that share the
SQLite file but not the event bus.

The **Vue SPA** (`web/`) is an independent Vite project that talks to `/api`
(proxied in dev, same-origin in prod). In production, the backend serves
`web/dist` with SPA fallback so all client-side routes resolve.

```
HTTP process:  request → auth middleware → REST route → service → SQLite
                                                          └→ event bus → SSE clients
                                                                ↑ relay POST
stdio process: stdin/stdout → MCP tool → service → SQLite (same file)
                                           └→ event bus → relay ─┘

browser:  Vue SPA → /api (cookie auth) → REST routes
                  → /api/stream (SSE, live updates)
```

## Scripts

| Script              | Action                                                     |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Backend dev server (tsx watch)                             |
| `npm run dev:all`   | Backend + frontend dev servers concurrently                |
| `npm run web:dev`   | Frontend dev server only (Vite, port 5173)                 |
| `npm run build`     | Build backend (`tsc`) + frontend (`vue-tsc && vite build`) |
| `npm start`         | Run compiled server (serves SPA at `/`)                    |
| `npm run auth`      | Mint a PIN to pair a browser session                       |
| `npm run init`      | Create an API key, save to `.env`                          |
| `npm run config`    | Interactive `.env` editor                                  |
| `npm run mcp`       | stdio MCP server (dev)                                     |
| `npm run mcp:start` | stdio MCP server (compiled)                                |
| `npm test`          | Run all tests                                              |
| `npm run format`    | Biome lint + format                                        |

## Tests

```bash
npm test     # node:test via tsx — services, auth, event bus, REST + SSE integration
npm run format
```
