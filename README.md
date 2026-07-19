# yot

A single-user calendar with a REST API, MCP server, SSE realtime feed, and a Vue 3 web UI. Written in Rust (axum + rusqlite).

## Install

Linux / Mac:

```bash
curl -sSL https://raw.githubusercontent.com/eitaar/yot/main/dist/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/eitaar/yot/main/dist/install.ps1 | iex
```

This downloads the latest release to `~/.yot/` (or `%APPDATA%\yot\`), adds it to PATH, and runs `yot init`.

### From source

```bash
cargo build --release
./target/release/yot init
./target/release/yot-server
```

Open `http://localhost:4010`. On first visit you'll be redirected to `/pair`:

```bash
./target/release/yot auth          # prints a 6-digit PIN
```

Enter the PIN in the browser to pair.

### Development

```bash
cargo run --bin yot-server         # backend on :4010
cd web && npm install && npm run dev  # Vite dev server on :5173 (proxies /api)
```

## Data directory

All data lives in one directory, created by `yot init`:

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\yot\` |
| Linux/Mac | `~/.yot/` |

Contents: `yot-server`, `yot-mcp`, `yot`, `data.db`, `img/`, `.env`. Override with `YOT_DATA_DIR`.

## Authentication

Send an API key as a header:

```
Authorization: Bearer cal_xxxxxxxx
```

Also accepted: `X-Api-Key`, bare `Authorization`, `?key=` query param (for SSE/images), or `yot_session` cookie (browser).

Scopes: `read` keys allow GET only; `write` keys allow everything.

### PIN pairing (browser)

1. `yot auth` mints a one-time 6-digit PIN (expires in 5 min)
2. Enter it at `/pair` to get a session cookie
3. `POST /api/auth/logout` revokes and clears the cookie

## REST API

Base path `/api`. Interactive docs at `/api/ui`, OpenAPI spec at `/api/doc`.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/health` | public |
| `POST` | `/auth/pair` | public, redeem PIN |
| `POST` | `/auth/logout` | public, clear session |
| `POST` | `/auth/pin` | mint a PIN |
| `GET` | `/auth/session` | current scope |
| `GET` `POST` | `/calendars` | list / create |
| `GET` `PATCH` `DELETE` | `/calendars/{id}` | |
| `GET` `POST` | `/events` | `?calendarId=&from=&to=&tag=&q=&limit=&offset=` |
| `GET` `PATCH` `DELETE` | `/events/{id}` | |
| `POST` | `/events/{id}/reminders` | |
| `DELETE` | `/events/{id}/reminders/{rid}` | |
| `POST` `DELETE` | `/events/{id}/tags/{tagId}` | attach / detach |
| `POST` | `/events/import` | multipart `.ics` (skips recurring) |
| `POST` | `/uploads/image` | multipart cover image |
| `POST` | `/uploads/image-from-url` | fetch remote image |
| `GET` | `/img/{file}` | serve stored image |
| `GET` `POST` | `/tags` | |
| `PATCH` `DELETE` | `/tags/{id}` | |
| `GET` | `/stream` | SSE feed |

Errors: `{ "error": { "code", "message", "details?" } }`

## SSE

```bash
curl -N "http://localhost:4010/api/stream?key=$KEY"
```

Events: `calendar.created|updated|deleted`, `event.created|updated|deleted`, `tag.created|updated|deleted`. A `ready` frame on connect, `ping` every 25s.

## MCP

The MCP server runs over stdio. Configure in `.mcp.json`:

```json
{
  "mcpServers": {
    "yot": {
      "command": "yot-mcp",
      "env": { "YOT_API_KEY": "cal_xxxx" }
    }
  }
}
```

Set `MCP_AUTH=off` to skip auth. 20 tools: `list_calendars`, `create_calendar`, `update_calendar`, `delete_calendar`, `list_events`, `get_event`, `create_event`, `update_event`, `delete_event`, `add_reminder`, `remove_reminder`, `get_event_image`, `upload_image_from_url`, `import_ics`, `list_tags`, `create_tag`, `update_tag`, `delete_tag`, `tag_event`, `untag_event`.

MCP mutations are relayed to the HTTP server's SSE feed when `YOT_API_KEY` is set (disable with `YOT_SSE_RELAY=off`).

## CLI

```
yot init [--name default] [--scope write]   # create data dir + API key
yot auth [--scope write]                    # mint a pairing PIN
yot keys                                    # list API keys
yot revoke <id>                             # revoke a key
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4010` | HTTP listen port |
| `YOT_DATA_DIR` | `%APPDATA%/yot` or `~/.yot` | Binaries + data directory |
| `DB_PATH` | `<data_dir>/data.db` | SQLite path |
| `IMG_DIR` | `<data_dir>/img` | Image storage |
| `YOT_API_KEY` | | API key for CLI/MCP |
| `MCP_AUTH` | `on` | `off` to skip MCP auth |
| `YOT_HTTP_URL` | `http://127.0.0.1:$PORT` | Base URL for relay/CLI |
| `YOT_SSE_RELAY` | `on` | `off` to disable MCP-to-SSE relay |

## Architecture

```
HTTP:   request → auth middleware → REST handler → service → SQLite
                                                     └→ event bus → SSE
                                                           ↑ relay
MCP:    stdin → JSON-RPC → tool handler → service → SQLite
                                            └→ event bus → relay ─┘

Browser:  Vue SPA → /api (cookie) → REST
                  → /api/stream (SSE)
```

## Tests

```bash
cargo test   # 49 tests: services, auth, import
```
