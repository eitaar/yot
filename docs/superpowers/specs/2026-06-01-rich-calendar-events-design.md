# Rich calendar events — design

- **Date:** 2026-06-01
- **Branch:** `feat/rich-calendar`
- **Status:** Approved (design); ready for implementation plan

## Summary

Enrich calendar events with five features:

1. **Cover image** — uploaded from the device *or* pasted as a remote URL; either way the file is stored locally under `data/img/` and the filename is saved in SQL.
2. **Link (URL)** — a single link on the event.
3. **Markdown description** — the existing `description` field is rendered as Markdown in the UI (no schema change).
4. **Cover view** — a new gallery view showing events as image-background cards with the text floating on top.
5. **.ics import** — upload an iCalendar file and create events from it (no export).

### Out of scope

- `.ics` **export** and subscribe feeds.
- **Recurring** events — already out of scope project-wide; recurring entries in an imported `.ics` are skipped and counted.
- `.ics` import as an **MCP tool** (file upload is awkward over stdio MCP) — REST-only.
- Full attachment manager / multiple images per event (one cover image only).
- Background garbage-collection of orphaned image files beyond best-effort unlink on delete/replace.

## 1. Data model (schema + migration)

Add three nullable columns to the `events` table in [src/db/schema.ts](../../../src/db/schema.ts):

| Column        | Type   | Meaning                                                                 |
| ------------- | ------ | ----------------------------------------------------------------------- |
| `image_path`  | `TEXT` | Filename under `data/img/` (e.g. `a1b2c3.webp`). `null` = no cover.     |
| `url`         | `TEXT` | Single link. `null` = none.                                             |
| `source_uid`  | `TEXT` | The `.ics` `UID` an event was imported from; used to skip re-import duplicates. |

Add an index on `source_uid` for the dedupe lookup.

**Migration approach.** There is no migration runner today — [src/db/connection.ts](../../../src/db/connection.ts) just executes `SCHEMA_SQL` (all `CREATE TABLE IF NOT EXISTS`). Adding columns to an existing DB therefore needs an explicit step:

- Update the `CREATE TABLE events (...)` in `SCHEMA_SQL` so **fresh** databases get the columns directly.
- In `connection.ts`, after running `SCHEMA_SQL`, run a small idempotent migration: read `PRAGMA table_info(events)`, and for each expected-but-missing column run `ALTER TABLE events ADD COLUMN ...`. This is safe to run on every boot.

Markdown needs **no** schema change — it re-renders the existing `description`.

## 2. Backend: schemas + service

- [src/schemas/event.ts](../../../src/schemas/event.ts):
  - `EventSchema` gains `image_path: string | null`, `url: string | null`, `source_uid: string | null` (read side).
  - `CreateEventSchema` / `UpdateEventSchema` accept `url` and `image_path`. `image_path` is validated as a **safe basename** (no `/`, `\`, or `..`; matches the `<uuid>.<ext>` pattern we write) to prevent path traversal. `source_uid` is **not** part of the public REST create/update schemas.
- [src/services/event.service.ts](../../../src/services/event.service.ts):
  - Thread the new columns through `create`, `update`, and `hydrate`/`hydrateMany` (insert/update SQL + the `EventRow` type + the hydrated object).
  - The service-level `create` input accepts an **optional** `source_uid` (defaulting to `null`) used **only** by the `.ics` import path; the REST `POST /events` route never populates it.
  - On `delete` and on image replacement during `update`, best-effort `unlink` of the now-unreferenced file under `data/img/` (ignore errors; never block the mutation).

## 3. Image handling — upload or paste-URL, both stored locally

Storage: `data/img/`. Both `data/` and `data/img/` are created on boot (alongside the existing `DB_PATH`). Filenames are `<uuid>.<ext>`.

Three small REST endpoints, all write-scoped and behind the existing auth middleware:

- `POST /api/uploads/image` — `multipart/form-data`, field `file`.
  - Validate MIME type ∈ {jpeg, png, webp, gif} and size ≤ **5 MB**.
  - Write `data/img/<uuid>.<ext>`; respond `{ "path": "<uuid>.<ext>" }`.
- `POST /api/uploads/image-from-url` — JSON `{ "url": "https://..." }`.
  - Validate scheme is `http(s)`; **SSRF guard**: reject `localhost`, loopback, link-local, and private IP ranges.
  - Fetch with a timeout; validate response `Content-Type` is an allowed image and the body is ≤ 5 MB (cap the read).
  - Save locally and respond `{ "path": "<uuid>.<ext>" }`.
- `GET /api/img/:file` — serve the file from `data/img/` with the correct content-type.
  - Auth: under `/api`, so the existing middleware applies. Browser `<img>` tags authenticate via the same-origin session cookie automatically; `?key=` is also accepted (same pattern as SSE) for programmatic clients.
  - Reject any `:file` that is not a known-safe basename.

**Client flow:** upload or paste-URL → receive `path` → include it as `image_path` in the event create/update call. Upload is intentionally **decoupled** from the JSON CRUD path so multipart never enters the event create/update body.

## 4. Markdown description

Frontend only. Add `markdown-it` to `web/`.

- **View mode:** render `description` with markdown-it configured `{ html: false, linkify: true, breaks: true }`, output via `v-html`.
  - Safe because `html: false` escapes embedded raw HTML and markdown-it blocks dangerous link protocols (`javascript:`, `file:`, etc.) out of the box — no separate sanitizer dependency required.
  - Configure links to open in a new tab (`target="_blank" rel="noopener"`).
  - This replaces the current ad-hoc `\n`-unescaping in [EventModal.vue](../../../web/src/components/EventModal.vue) (`breaks: true` handles line breaks).
- **Edit/create mode:** keep the plain `<textarea>` and add a small "Markdown supported" hint.

## 5. .ics import (no export)

Backend adds `ical.js` (Kewisch). New endpoint:

- `POST /api/events/import` — `multipart/form-data`: `file` (the `.ics`) + `calendar_id` (target).
  - Parse via `ICAL.parse` → `ICAL.Component`; iterate `getAllSubcomponents('vevent')`, wrap each in `ICAL.Event`.
  - **Skip recurring:** if the `vevent` has an `rrule` property, skip it (increment `skippedRecurring`).
  - Map: `SUMMARY → title` (fallback `"(untitled)"`), `DTSTART/DTEND → start_at/end_at` as ISO-UTC (a date-only `DTSTART` ⇒ `all_day: true`; if no `DTEND`, default end = start), `LOCATION → location`, `DESCRIPTION → description`, `URL → url`, `UID → source_uid`.
  - **Dedupe:** if an event with the same `source_uid` already exists, skip it (increment `skippedDuplicate`).
  - Create surviving events through `EventService.create` so the SSE feed fires per event.
  - Respond `{ created, skippedRecurring, skippedDuplicate, errors }` (errors is a list of per-event parse failures; one bad VEVENT does not abort the import).
- **Frontend:** an "Import .ics" action (e.g. in the sidebar / a menu) → file picker + target-calendar select → POST → toast the summary counts.

## 6. UI

### EventModal ([web/src/components/EventModal.vue](../../../web/src/components/EventModal.vue))

- **View mode:** cover image on top (if `image_path`), markdown-rendered description, URL shown as a clickable link.
- **Edit/create mode:** a cover field (upload button **and** a paste-URL input, with a thumbnail preview and a remove button) plus a URL text input. On choosing a file or pasting a URL, call the matching upload endpoint, store the returned `path` in the form, and submit it as `image_path`.

### Cover view (locked design)

- New client route + a **"Cover"** entry in the existing view switcher (alongside Calendar / List).
- Grid of **3:2** cards: cover image as the card background; `title` + date overlaid bottom-left in white with a drop-shadow and **no background panel/box**. Events without a cover use a gradient derived from the calendar color, with the same overlaid text.
- Reuses the List view's event query/filters; clicking a card opens the EventModal.

## 7. MCP parity

Update the MCP tool schemas in [src/mcp/server.ts](../../../src/mcp/server.ts) so `create_event`, `update_event`, `get_event`, and `list_events` include `url` and `image_path`, keeping MCP in sync with REST. (`.ics` import stays REST-only.)

## Libraries

Confirmed via Context7:

- **`markdown-it`** — Markdown → HTML in the browser. Safe with `html: false`; no extra sanitizer needed.
- **`ical.js`** (`/kewisch/ical.js`) — parse `.ics` server-side: iterate `vevent` components, read `summary/dtstart/dtend/location/description/url/uid`, detect recurring via the presence of an `rrule` property.

## Testing

Following the existing `node:test`-via-`tsx` pattern (services, auth, REST integration):

- **Migration:** boots against a DB created from the *old* schema and asserts the new columns exist and are queryable; idempotent on re-run.
- **Event service:** `create`/`update`/`get` round-trip `image_path` and `url`; best-effort unlink does not throw when the file is missing.
- **Upload endpoints:** reject oversized / wrong-type uploads; `image-from-url` rejects non-http(s) and private/loopback hosts (SSRF) and over-cap bodies; `image_path` basename validation rejects traversal.
- **Image serving:** `GET /api/img/:file` returns the bytes with the right content-type and 404s unknown files; rejects unsafe names.
- **.ics import:** maps a known fixture correctly; skips recurring (count); dedupes by `source_uid`; a malformed VEVENT is reported in `errors` without aborting the batch.
- **Frontend:** markdown render escapes raw HTML; cover view renders the calendar-gradient fallback when `image_path` is null.
