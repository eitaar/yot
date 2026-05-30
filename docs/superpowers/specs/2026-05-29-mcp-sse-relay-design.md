# MCP → SSE change relay — design

Date: 2026-05-29
Status: approved (pre-implementation)

## Context

`yot` recently moved its MCP server from an HTTP `/mcp` endpoint to a **stdio**
entry point (`src/mcp/stdio.ts`). That made the MCP server a *separate process*
from the HTTP server (REST + SSE + web console). Each process has its own
in-memory `EventBus`, so a mutation made through an MCP tool emits only on the
MCP process's bus — which has no subscribers — and never reaches the HTTP
server's SSE feed. Result: the web console does **not** reflect changes made by
the MCP agent until a manual refresh.

**Goal:** when the MCP agent changes something, the web console / SSE clients
should reflect it **almost instantly**. (Direction is one-way: MCP → web/SSE.
REST → MCP and MCP → MCP are explicitly out of scope.)

## Approach

Push, not poll. The MCP process already emits every change on its in-memory bus
(that's how the tools drive the services). We attach a **relay** that forwards
each `ChangeEvent` to the HTTP server over a small authenticated `POST`, and the
server replays it onto *its* bus — so the existing SSE path
(`registerStreamRoute` in `src/rest/stream.ts`) fans it out to web clients with
no web-console changes at all.

SSE is server→client only, so it cannot be the MCP→server uplink; a plain HTTP
`POST` per change is the uplink. A WebSocket was considered and rejected: it adds
`@hono/node-ws` + reconnect lifecycle and buys nothing for an agent that writes
infrequently. Polling a shared SQLite change-log was also considered and rejected
in favor of push (no ~250 ms delay, no new table).

### Data flow

REST/web change (unchanged, works today):

```
Web console → POST /api/events → EventService.create()
                                    ├─→ SQLite
                                    └─→ EventBus(HTTP).emit({type,data}) → SSE → Web console ✅
```

MCP change (this feature):

```
MCP agent → (stdio) → create_event tool → EventService.create()
                                             ├─→ SQLite
                                             └─→ EventBus(MCP).emit({type,data})
                                                    └─→ relay → POST /api/internal/events  (auth: YOT_API_KEY)
                                                                   └─→ EventBus(HTTP).emit({type,data})
                                                                          └─→ SSE → Web console ✅ (~instant)
```

## Components

### 1. HTTP server: `POST /api/internal/events`

New file `src/rest/internal.ts` exporting `registerInternalRoutes(api, bus)`,
called from `buildApp` (`src/rest/app.ts`) immediately after the auth gate,
parallel to `registerStreamRoute`.

- Request body validated with a Zod schema: `type` is a non-empty string matching
  a change-event shape (`/^[a-z]+\.[a-z]+$/`, e.g. `event.created`); `data` is any
  JSON value. Invalid → `400` via the existing `defaultHook`/`onError` envelope.
- Handler: `bus.emit({ type, data })`, then respond `204` (no body).
- Because it lives under `/api`, it inherits `authenticate(services.apiKeys)` and
  `requireWriteForMutations()` — so it requires a valid **write**-scoped key. It is
  registered with a plain `api.post` (not `api.openapi`), so it does **not** appear
  in the OpenAPI document at `/api/doc`.

### 2. MCP process: change relay

New file `src/mcp/relay.ts`:

```ts
startChangeRelay(bus, { url, apiKey, fetchImpl? }): () => void
```

- Subscribes to the MCP process's `EventBus`. On each `ChangeEvent`, fires
  `fetch(url, { method: "POST", headers: { authorization: "Bearer <key>",
  "content-type": "application/json" }, body: JSON.stringify({ type, data }) })`.
- **Fire-and-forget, best-effort.** The fetch is not awaited in the bus listener;
  a rejected promise or non-`2xx` response is caught and logged to stderr and
  never propagates into the tool call (the DB write already succeeded). Returns an
  unsubscribe function.
- `fetchImpl` is injectable for tests (defaults to global `fetch`).

Wired in `src/mcp/stdio.ts` after `buildMcpServer(...)`: resolve the target URL
and key, and if both are present call `startChangeRelay(bus, …)`.

### 3. Configuration (MCP process)

| Variable        | Default                          | Purpose                                            |
| --------------- | -------------------------------- | -------------------------------------------------- |
| `YOT_HTTP_URL`  | `http://127.0.0.1:${PORT ?? 4010}` | Base URL of the HTTP server; relay POSTs to `…/api/internal/events` |
| `YOT_API_KEY`   | —                                | Write key used to authenticate the relay POST      |
| `YOT_SSE_RELAY` | `on`                             | `off`/`false`/`0`/`no` force-disables the relay    |

Relay enablement: enabled when `YOT_SSE_RELAY` is not disabled **and** a
`YOT_API_KEY` is available. If disabled or no key (e.g. `MCP_AUTH=off` with no key
set), the relay logs one stderr note and stays off — MCP tools still work, just
without live fan-out. The relay key must be a **write** key on the HTTP server
(the `/internal/events` endpoint enforces write); `MCP_AUTH` only governs the MCP
server's own tool scope, independent of the relay.

## Error handling / safety

- **No loops.** The relay runs only in the MCP process. The `/internal/events`
  handler only emits to the HTTP bus and never relays anything; the HTTP process
  has no relay subscriber. So a relayed event cannot bounce back.
- **Endpoint responses:** `401` missing/invalid key, `403` read-scoped key, `400`
  malformed body, `204` success — all through the existing error envelope.
- **Delivery is at-least-once / best-effort.** Under a burst, independent
  fire-and-forget POSTs may land slightly out of order. Acceptable for a UI feed:
  each frame carries the full hydrated entity, so the console renders correct
  final state. No sequencing/retry is added (YAGNI).
- **Security.** `/api/internal/events` lets an authenticated write-key holder
  inject arbitrary change frames to all SSE clients. Acceptable for a localhost
  single-user tool and it is auth-gated; documented in `spec.md` §12.

## Testing

- **Integration** — `src/rest/internal.test.ts`, mirroring `src/rest/stream.test.ts`:
  with a write key, `POST /api/internal/events` causes a subscribed SSE client to
  receive the frame; assert `401` (no key), `403` (read key), `400` (bad `type`).
- **Unit** — `src/mcp/relay.test.ts`: inject a fake `fetch`; emitting a
  `ChangeEvent` on the bus invokes it with the correct URL, `Authorization`
  header, and JSON body `{type,data}`; a rejecting fetch is swallowed (no throw);
  the relay no-ops when constructed without a key.
- **Manual E2E**: start the HTTP server (`npm run dev`), open the web console,
  run the stdio MCP server, invoke `create_event`, and watch the SSE frame appear
  live in the console.

## Docs to update

- `spec.md`: §2.1 (note the MCP→SSE relay restores one-way fan-out), new env vars
  in §10, the relay endpoint + security note in §8 / §12.
- `README.md`: MCP section note that MCP changes now reach the SSE feed via the
  relay, plus the new env vars.

## Out of scope

- REST → MCP and MCP → MCP propagation (no notifications pushed *to* MCP clients).
- Retry/queue/durability for missed events while the HTTP server is down.
- WebSocket transport; shared change-log table.
