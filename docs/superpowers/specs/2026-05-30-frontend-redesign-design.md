# Frontend Redesign + Tag Management Design

Date: 2026-05-30
Status: Approved

## Problem

The current web UI is unstyled (bare Tailwind + stock Schedule-X) and exposes
too little of the backend. Specifically the user reported:

1. The UI looks bad and unfriendly; the default Schedule-X look is unacceptable.
2. The frontend can delete a calendar by accident — it must not be able to.
3. Calendar colors cannot be changed from the frontend.
4. There is no tag management (create / rename / recolor / delete, assign to events).
5. The always-visible "add event" form is clumsy; event creation should use a modal.

## Goals

- A polished, friendly, non-default visual design.
- Remove all calendar-deletion paths from the frontend.
- Edit calendar color (and name) from the frontend.
- Full tag management in the frontend, including recolor and assigning tags to events.
- Replace the always-on event form with a single create/view/edit modal.

## Non-Goals (YAGNI)

- Reminders UI, recurring events, drag-to-create / resize.
- An MCP tool for updating tags (only REST is needed for the web UI).
- Any calendar-deletion UI (deletion remains available via API/MCP only).

## Decisions (from brainstorming)

- **Layout:** Refined sidebar app. Left sidebar (~14rem) with `＋ New event`,
  CALENDARS, TAGS, and the live-connection indicator. Calendar fills the rest.
  A slim top bar holds the brand, a Calendar/List switch, and logout.
- **Theme:** Auto — follow the OS `prefers-color-scheme`, toggling a `dark`
  class on `<html>`. All components carry `dark:` variants.
- **Accent:** Emerald (emerald-600 base, emerald-700 hover).
- **Color picker:** Curated swatch palette (~10 colors) + a custom hex option.
- **Tag management location:** Inline in the sidebar (add field + per-tag `⋯`
  popover). Assigning tags to an event happens in the event modal.
- **Calendar engine:** Keep Schedule-X but reskin it via CSS variable overrides
  and drive its `isDark` from the system theme. Not a from-scratch grid.
- **Event form:** Remove the always-on `EventForm.vue`; the modal owns
  create / view / edit.

## Architecture

### Visual system

`web/src/style.css` gains, after `@import "tailwindcss";`:

- An `@theme` block defining accent tokens and reused radii/shadows.
- A `@custom-variant dark` (class strategy) so `dark:` utilities respond to the
  `.dark` class on `<html>` rather than only the media query.
- A scoped block overriding Schedule-X CSS variables (accent / today / border /
  font, and the dark-theme variables) so the calendar matches the new look.

`web/src/composables/useTheme.ts` (new): a module-level singleton that reads
`window.matchMedia("(prefers-color-scheme: dark)")`, applies/removes `dark` on
`document.documentElement`, exposes `isDark: Ref<boolean>`, and updates on change.
Initialized once from `main.ts`.

### Components

- **`ColorPicker.vue`** (new): props `modelValue: string | null`; emits
  `update:modelValue`. Renders a row of preset swatches plus a "custom" control
  (`<input type="color">`) for arbitrary hex. Self-contained, no API calls.
- **`Popover.vue`** (new): a small click-to-open menu anchored to a trigger
  (the `⋯` button). Closes on outside-click and Escape. Slot-based content so it
  can host both the calendar and tag menus. One clear job: show/hide a floating
  panel.
- **`Sidebar.vue`** (rewritten):
  - Calendars: checkbox (visibility) + color dot + name + `⋯` popover. The
    popover offers **Rename** (inline text input) and **Color** (ColorPicker).
    **No delete control.**
  - Tags: `＋` add row (name + ColorPicker). Each tag is a filter chip; a `⋯`
    popover offers **Rename**, **Recolor**, and **Delete** (with confirm).
  - Live indicator stays at the bottom.
  - Props: `calendars`, `tags`, `connected`, `enabledCalendarIds`, `selectedTag`.
  - Emits: `toggle-calendar`, `set-all`, `select-tag`, `add-calendar`,
    `rename-calendar`, `recolor-calendar`, `add-tag`, `rename-tag`,
    `recolor-tag`, `delete-tag`. (No `remove`/`remove-calendar`.)
- **`EventModal.vue`** (rewritten): modes `create | view | edit`.
  - `create`: empty form; `＋ New event` opens it. On save, create the event,
    then apply selected tags via the event-tag endpoints.
  - `view`: read-only details (title, calendar dot+name, date range, location,
    description, tag chips). Buttons: Edit, Close.
  - `edit`: title, calendar select, all-day checkbox, start/end (date or
    datetime per all-day), location, description, and **tag toggle chips**.
    Buttons: Save, Cancel.
  - Props: `mode`, `event` (null for create), `calendars`, `tags`.
  - Emits: `close`, `create(input, tagIds)`, `save(id, updates, tagIds)`.
- **`App.vue`**: slim top bar (brand, Calendar/List links, logout) styled to the
  new system; main area renders the active view.
- **`EventForm.vue`**: removed.

### Views

- **`CalendarView.vue`**: keeps the Schedule-X integration (per-calendar colors
  via the internal calendars signal, `onEventClick` → modal, calendar/tag
  filters). Adds the `＋ New event` trigger (create mode) and the sidebar's new
  calendar/tag management handlers. Drops `EventForm`.
- **`ListView.vue`**: same management wiring; rows stay clickable (open modal),
  show calendar dot + tag chips + location; `＋ New event` available; search
  retained.

### API client (`web/src/api/client.ts`)

- **Add:** `updateCalendar(id, input)` → `PATCH /calendars/{id}`.
- **Add:** `createTag(input)`, `updateTag(id, input)` → `PATCH /tags/{id}`,
  `deleteTag(id)`.
- **Add:** `addEventTag(eventId, tagId)`, `removeEventTag(eventId, tagId)` using
  the existing `/events/{id}/tags/{tagId}` endpoints.
- **Remove:** `deleteCalendar` (no frontend deletion path).
- Add `CalendarUpdate` and `TagUpdate` types mirroring the backend schemas.

### Composables

- `useCalendars`: add `update(id, input)`; **remove** `remove()`.
- `useTags`: add `create`, `update`, `remove` (each reloads).
- `useEvents`: add helpers to assign/unassign tags (used by the modal after
  create, and during edit to diff the tag set). `update()` already exists.

### Backend additions (tag update)

Tags currently support create / list / delete only. To recolor/rename a tag the
backend needs an update path:

- `schemas/tag.ts`: add `UpdateTagSchema` (`name?`, `color?` nullable) and
  `UpdateTagInput`.
- `services/tag.service.ts`: add `update(id, input): Tag` — load existing (404 if
  missing), apply provided fields, persist, emit a new `tag.updated` change
  event, return the updated tag. Duplicate-name updates throw `ConflictError`
  (same handling as create).
- `rest/tags.ts`: add `PATCH /tags/{id}` (200 `Tag`, 404, 409).
- SSE: the stream forwards every event generically by `type`, so no stream code
  change is required. The frontend adds `tag.updated` to its listener list.

## Data Flow

- Mutations call the REST API; on success the backend emits a change event; the
  SSE stream forwards it; `useSSE` triggers each view's `refresh()`, which
  reloads calendars / tags / events and re-syncs Schedule-X. This keeps multiple
  clients and MCP-driven changes in sync, unchanged from today.
- Tag assignment on **create**: create event → for each selected tag, call
  `addEventTag`. On **edit**: diff current vs. selected tag ids; add the new
  ones and remove the deselected ones.

## Error Handling

- API errors surface as today (thrown `ApiError`). Modal/save actions catch and
  show an inline message rather than failing silently; the modal stays open so
  the user can retry. Tag delete and any destructive tag action confirm first.
- Creating/renaming a tag to a duplicate name yields a 409 → inline "name already
  exists" message.

## Testing

- **Backend (unit, `node:test`):** `TagService.update` — changes fields and
  emits `tag.updated`; unknown id throws `NotFoundError`; duplicate name throws
  `ConflictError`. REST: `PATCH /tags/{id}` returns 200 with the updated tag and
  404 for an unknown id. Run via `npm test`.
- **Frontend:** type-check + build via `npm run build` (vue-tsc + vite). Manual
  verification of the redesigned flows (see below) since there is no FE test
  harness in this project.

## Verification

1. `npm test` — backend suite green, including new tag-update tests.
2. `npm run build` (root) — backend tsc + web vue-tsc/vite build clean.
3. Manual (`npm run dev` + `npm --prefix web run dev`):
   - Redesigned shell renders; light/dark follows OS; emerald accents present.
   - No delete control on calendars anywhere.
   - Calendar `⋯` → rename and recolor; colors update live in sidebar + grid.
   - Tag `＋` adds; tag `⋯` → rename / recolor / delete (with confirm); chip
     click still filters.
   - `＋ New event` opens an empty modal; create works and assigned tags stick.
   - Click event → view → Edit → Save persists; tag toggles apply.
   - List view mirrors all of the above; search still works alongside filters.
