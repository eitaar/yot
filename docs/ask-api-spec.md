# yot Ask API Specification

## Overview

The Ask endpoint allows yot-client to send natural language queries about the user's calendar. yot-server proxies the query to a Hermes Agent API Server, which uses yot MCP tools to read calendar data and generate a response.

## Architecture

```
yot-client
  → POST /api/ask (with yot API key)
    → yot-server
      → Hermes API Server (127.0.0.1:8642)
        → Hermes AIAgent + yot MCP tools (20 tools)
        ← OpenAI Chat Completions JSON
      ← Ask JSON
    ← Ask JSON
```

- yot-client knows only the yot API key.
- Hermes API key is stored in yot-server's environment and never exposed to clients.
- Hermes uses yot MCP (stdio) to read/write calendar data directly.
- Each request gets a unique `X-Hermes-Session-Key` for stateless isolation.

## Endpoint

### `POST /api/ask`

Send a natural language query about the user's calendar.

#### Authentication

Requires a valid yot API key via any supported method:

- `Authorization: Bearer <key>` header
- `X-API-Key: <key>` header
- `yot_session=<key>` cookie
- `?key=<key>` query parameter

Both `read` and `write` scope keys are accepted. The Ask endpoint is read-only from yot-server's perspective — it does not modify calendar data directly. However, Hermes may use write-scope MCP tools if the configured `YOT_API_KEY` has write access.

#### Request

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | The user's natural language question. |
| `context` | string | No | Additional context for the AI (e.g. timezone, language preference). |

**Example:**

```json
{
  "query": "来週の予定は？",
  "context": "ユーザーのタイムゾーンは Asia/Tokyo です"
}
```

#### Response

| Field | Type | Description |
|---|---|---|
| `answer` | string | The AI-generated response text. |
| `model` | string | The model name used (typically `hermes-agent`). |
| `usage` | object \| null | Token usage statistics from the AI, if available. |

**Example:**

```json
{
  "answer": "来週は3件の予定があります。\n\n1. 「打ち合わせ」— 8/4(月) 10:00〜11:00\n2. 「歯医者」— 8/6(水) 15:00〜16:00\n3. 「evil stream」— 8/8(金) 03:00〜05:30 (Twitch)",
  "model": "hermes-agent",
  "usage": {
    "prompt_tokens": 50829,
    "completion_tokens": 361,
    "total_tokens": 51190
  }
}
```

#### Errors

| Status | Code | Cause |
|---|---|---|
| 400 | `validation_error` | Missing `query` field or malformed JSON. |
| 401 | `unauthorized` | Missing or invalid API key. |
| 403 | `forbidden` | Read-scope key used on a write-only endpoint (not applicable to Ask). |
| 500 | `internal_error` | Hermes API Server unreachable, key not configured, or upstream error. |

**Error format:**

```json
{
  "error": {
    "code": "internal_error",
    "message": "Hermes API key not configured"
  }
}
```

## Server Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `HERMES_API_URL` | No | `http://127.0.0.1:8642/v1/chat/completions` | Full URL to Hermes API Server's Chat Completions endpoint. |
| `HERMES_API_KEY` | **Yes** | — | API key for the Hermes API Server. Must match the key configured in Hermes `config.yaml` under `platforms.api_server.key`. |

### Hermes API Server Configuration

In `~/.hermes/config.yaml`:

```yaml
platforms:
  api_server:
    enabled: true
    port: 8642
    host: 127.0.0.1
    key: "<HERMES_API_KEY value>"
```

### yot MCP Configuration

The yot MCP server must be registered in Hermes config:

```yaml
mcp_servers:
  yot:
    command: /home/clawd/.yot/yot-mcp
    enabled: true
```

The yot MCP process reads `YOT_API_KEY` from the environment and uses it to authenticate against the yot-server SQLite database. The MCP server shares the same database file as yot-server.

## System Prompt

The Ask endpoint sends the following system prompt to Hermes:

```
You are a calendar assistant for yot. Use the available yot MCP tools to answer questions about the user's calendar. Be concise and answer in the user's language.
```

If the request includes a `context` field, it is appended as a second system message.

## Rate Limiting

The Ask endpoint does not currently have its own rate limiting. The standard yot-server rate limiter (if configured) applies to all endpoints.

## Future Enhancements

- **SSE streaming**: Return `stream: true` to Hermes and proxy SSE chunks to the client for token-by-token display.
- **Session continuity**: Use a persistent session key per device/user for multi-turn conversations.
- **Context injection**: Automatically inject current time, timezone, and recent events as context.
- **Rate limiting**: Per-key rate limits on the Ask endpoint to control Hermes API costs.