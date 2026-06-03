---
name: yot-control
description: Use when an AI agent needs to read or manage a user's calendars, events, reminders, or tags in the yot calendar backend — scheduling, rescheduling, looking up what is on a date, searching, tagging, or bulk-organizing events — via the yot MCP tools or its REST API.
---

# Controlling yot (calendar backend)

## Overview

yot is a single-user calendar backend that exposes the **same CRUD over MCP
tools and a REST API**. Prefer the **MCP tools** when the yot server is connected
(tool names below; some clients namespace them, e.g. `mcp__yot__create_event`).
Otherwise call the REST API under `/api` with an API key.

Data model: `calendars → events → reminders`, plus `events ↔ tags`
(many-to-many). Every event belongs to exactly one calendar.

## Golden rules

- **Times are ISO-8601, UTC** (e.g. `2026-06-10T15:00:00.000Z`). `end_at` must be
  ≥ `start_at`. Convert any local/naive time to UTC before sending.
- **An event needs a real `calendar_id`.** Always `list_calendars` first; create
  one with `create_calendar` if none fits. Creating an event in a missing
  calendar fails with 404.
- **Tags attach by id, not name.** An event's `tags` field is a list of *names*,
  but to attach you call `tag_event(event_id, tag_id)`. Ensure the tag exists
  (`list_tags`, or `create_tag` → returns its `id`), then attach by that id.
- **No recurring events** — yot stores one-off events only. Do not encode an RRULE.
- **Reminders are metadata only** — `add_reminder` records `minutes_before` /
  `method`; the server never fires a notification.
- A **read-scoped** key only permits the read tools; write tools return an error
  result.

## Tools (quick reference)

| Goal | Tool | Key inputs |
|---|---|---|
| List calendars | `list_calendars` | — |
| New calendar | `create_calendar` | name, color?, description? |
| Edit / remove calendar | `update_calendar` / `delete_calendar` | id (+ fields) |
| Find events | `list_events` | calendarId?, from?, to?, tag?, q?, limit?, offset? |
| One event | `get_event` | id |
| New event | `create_event` | calendar_id, title, start_at, end_at, all_day?, description?, location?, url?, image_path? |
| Edit / remove event | `update_event` / `delete_event` | id (+ fields) |
| Add / remove reminder | `add_reminder` / `remove_reminder` | event_id (+ minutes_before / reminder_id) |
| Upload cover image | `upload_image_from_url` | url → `{ path }` (set as `image_path`) |
| View an event's cover | `get_event_image` | id → image |
| Import `.ics` | `import_ics` | calendar_id, ics (text) |
| List / new tag | `list_tags` / `create_tag` | (name, color?) |
| Edit / remove tag | `update_tag` / `delete_tag` | id (+ name?, color?) |
| Tag / untag event | `tag_event` / `untag_event` | event_id, tag_id |

`list_events`: `from`/`to` bound `start_at` (inclusive); `q` searches title +
description; `tag` filters by tag **name**; `limit` 1–500 (default 50).

## Common workflows

**Schedule an event**
1. `list_calendars` → pick one, or `create_calendar`.
2. `create_event` with `calendar_id`, `title`, ISO `start_at`/`end_at` (set
   `all_day: true` for an all-day event).
3. Optional: `tag_event` (after resolving the tag id), `add_reminder`.

**Reschedule** → `update_event(id, { start_at, end_at })` — send only the fields
that change.

**"What's on my calendar this week?"** → `list_events({ from, to })` with the
week's UTC bounds; narrow with `calendarId`, `tag`, or `q`.

**Organize with a tag** → `create_tag` (capture the returned `id`) →
`list_events` to find targets → `tag_event` each one.

## REST fallback

If MCP is not wired up, every operation maps to `/api` with
`Authorization: Bearer cal_...`. The MCP tools now cover the full REST CRUD
(including cover images and `.ics` import); only the SSE `/stream` feed and the
auth pairing routes are REST-only. See [reference.md](reference.md) for full tool
parameters and return shapes, the REST endpoint table, field semantics, and error
codes.

## Common mistakes

- Sending a local/naive timestamp → always convert to UTC ISO-8601.
- Creating an event before its calendar exists → 404 "Calendar not found".
- Calling `tag_event` with a tag **name** → it needs the tag **id** from
  `list_tags` / `create_tag`.
- Expecting reminders to notify the user → they are stored data only.
- Trying to model a repeating event → not supported; create individual events.
