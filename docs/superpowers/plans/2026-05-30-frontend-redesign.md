# Frontend Redesign + Tag Management — Implementation Plan

## Overview

Redesign the web UI (polished, friendly, auto light/dark, emerald accent),
remove all calendar-deletion paths from the frontend, allow editing calendar
color/name, add full tag management (create/rename/recolor/delete + assign to
events), and replace the always-on event form with a single create/view/edit
modal.

Source of truth: `docs/superpowers/specs/2026-05-30-frontend-redesign-design.md`.

Work proceeds in dependency order: backend tag-update (TDD) → API client →
composables → visual system → shared components → views/shell → cleanup →
verification. Each task lists exact files, what to write, and how to verify.
Steps are bite-sized and assume no prior context beyond this document and the
spec.

## Prerequisites

- [ ] On branch `feat/webui` (not main).
- [ ] Backend REST API exists (`src/rest/`) with calendars, events, tags; SSE at
      `/api/stream`; Schedule-X frontend in `web/`.
- [ ] Existing frontend already has `useFilters`, `EventModal`, sidebar
      checkboxes, calendar/tag filters (from the prior commit `e636d27`).

## Conventions

- TypeScript strict; no `any` (the one existing Schedule-X internal cast in
  `CalendarView` is allowed and commented).
- Tabs for indentation; double quotes (Biome config).
- Composables return refs + actions; module-level singletons for shared state.
- Tailwind utility classes; the only CSS file is `web/src/style.css`.
- Backend tests: `node:test` run via `npm test`. Frontend: type-check + build via
  `npm run build` (root runs backend `tsc` + web `vue-tsc`/`vite`).
- Use TDD for the backend change (test first, then implement).

## Color palette (shared constant)

Used by `ColorPicker.vue` for both calendars and tags. ~10 swatches:

```
#ef4444 #f97316 #f59e0b #84cc16 #10b981 #06b6d4 #3b82f6 #6366f1 #a855f7 #ec4899
```

---

## Task 1: Backend — tag update (TDD)

**Files:**
- `src/schemas/tag.ts` (edit)
- `src/services/tag.service.ts` (edit)
- `src/services/tag.service.test.ts` (edit)
- `src/rest/tags.ts` (edit)
- `src/rest/app.test.ts` (edit — REST-level test, if that is where route tests live)

**Step 1.1 — Write failing service test**

In `src/services/tag.service.test.ts` add cases:
- `update changes fields and emits tag.updated` — create a tag, call
  `update(id, { name, color })`, assert returned tag reflects changes and a
  `tag.updated` event was emitted with the updated tag.
- `update throws NotFoundError for unknown id`.
- `update to a duplicate name throws ConflictError` — create two tags, update one
  to the other's name.

Run `npm test` → these fail (no `update` method yet).

**Step 1.2 — Add schema**

In `src/schemas/tag.ts` add:

```ts
export const UpdateTagSchema = z
	.object({
		name: z.string().min(1).optional(),
		color: z.string().nullable().optional(),
	})
	.openapi("UpdateTag");

export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;
```

**Step 1.3 — Implement service method**

In `src/services/tag.service.ts` add `update(id, input): Tag`:
- Load existing via `get(id)` (throws `NotFoundError` if missing).
- Compute next `name`/`color` (use provided value when present, else current;
  `color` is nullable so distinguish `undefined` from `null`).
- `UPDATE tags SET name = @name, color = @color WHERE id = @id`.
- Wrap in the same `try/catch` as `create` to map `UNIQUE` → `ConflictError`.
- `this.bus.emit({ type: "tag.updated", data: updated })`; return updated.

Run `npm test` → service tests pass.

**Step 1.4 — Add REST route + test**

In `src/rest/tags.ts` add `PATCH /tags/{id}` mirroring the calendars PATCH route
(import `UpdateTagSchema`; responses 200 `TagSchema`, 404, 409) calling
`tagSvc.update(...)`.

Add/extend a REST test (follow the pattern already used for tag/calendar routes
in `src/rest/app.test.ts`) asserting `PATCH /tags/{id}` returns 200 with the
updated tag and 404 for an unknown id.

**Step 1.5 — Verify**

```bash
npm test
```

Expected: all tests pass, including the new tag-update cases. No stream code
change needed (the SSE endpoint forwards every event generically by `type`).

---

## Task 2: API client — calendar update, tag CRUD, event-tag assign, drop delete

**Files:** `web/src/api/client.ts` (edit)

**Step 2.1 — Types**

Add after the existing types:

```ts
export type CalendarUpdate = Partial<{
	name: string;
	color: string | null;
	description: string | null;
}>;
export type TagUpdate = Partial<{ name: string; color: string | null }>;
```

**Step 2.2 — Methods**

- Add `updateCalendar(id, input: CalendarUpdate)` → `PATCH /calendars/{id}`.
- **Remove** `deleteCalendar`.
- Add `createTag(input: { name: string; color?: string })` → `POST /tags`.
- Add `updateTag(id, input: TagUpdate)` → `PATCH /tags/{id}`.
- Add `deleteTag(id)` → `DELETE /tags/{id}`.
- Add `addEventTag(eventId, tagId)` → `POST /events/{id}/tags/{tagId}` (returns
  `Event`).
- Add `removeEventTag(eventId, tagId)` → `DELETE /events/{id}/tags/{tagId}`
  (returns `Event`).

**Step 2.3 — Verify**

```bash
cd web && npx vue-tsc --noEmit
```

Expected: no type errors from the client itself. (`useCalendars` will error until
Task 3 — that's fine; do them together if preferred.)

---

## Task 3: Composables — calendars, tags, events

**Files:** `web/src/composables/useCalendars.ts`, `useTags.ts`, `useEvents.ts` (edit)

**Step 3.1 — useCalendars**

- Add `update(id, input: CalendarUpdate)` → `api.updateCalendar` then `load()`.
- **Remove** `remove()` and stop returning it.

**Step 3.2 — useTags**

- Add `create(name, color?)`, `update(id, input: TagUpdate)`, `remove(id)` — each
  calls the API then `load()`. Keep `tags`, `load`.

**Step 3.3 — useEvents**

- Add `addTag(eventId, tagId)` and `removeTag(eventId, tagId)` (call API; no
  reload — the modal batches these then triggers one refresh).
- `update()` already exists. Keep `create`, `load`, `remove`.

**Step 3.4 — Verify**

```bash
cd web && npx vue-tsc --noEmit
```

Expected: only errors remaining are in components still referencing removed
calendar-delete (fixed in later tasks).

---

## Task 4: Visual system — tokens, dark mode, Schedule-X reskin

**Files:** `web/src/style.css` (edit), `web/src/composables/useTheme.ts` (new),
`web/src/main.ts` (edit)

**Step 4.1 — style.css**

After `@import "tailwindcss";` add:
- `@custom-variant dark (&:where(.dark, .dark *));` so `dark:` utilities track the
  `.dark` class on `<html>`.
- An `@theme` block defining `--color-accent` (emerald-600) and
  `--color-accent-hover` (emerald-700), plus any shared radius token.
- A scoped override block for Schedule-X CSS variables (light + dark) to set the
  accent, today highlight, border color, and font so the calendar matches. Drive
  dark via the `.dark` selector. (Look up exact `--sx-*` variable names from
  `@schedule-x/theme-default` at implementation time.)

**Step 4.2 — useTheme.ts**

Module-level singleton:
- `isDark = ref(mql.matches)` where `mql = matchMedia("(prefers-color-scheme: dark)")`.
- `apply()` toggles `document.documentElement.classList` `dark`.
- Listen to `mql` `change` → update `isDark` + `apply()`.
- Export `useTheme()` returning `{ isDark }`; call an `initTheme()` once.

**Step 4.3 — main.ts**

Import and initialize the theme before mounting.

**Step 4.4 — Verify**

```bash
cd web && npm run build
```

Expected: builds clean. Manual: OS dark mode toggles the `.dark` class.

---

## Task 5: ColorPicker component

**Files:** `web/src/components/ColorPicker.vue` (new)

**Step 5.1 — Implement**

- Props: `modelValue: string | null`. Emits `update:modelValue`.
- Render the shared palette as clickable swatches (selected one ringed in
  accent). A "custom" trigger reveals `<input type="color">` bound to emit any
  hex. Compact, styled, dark-aware.

**Step 5.2 — Verify**

`npm run build` clean (component may be unused until Task 7 — acceptable).

---

## Task 6: Popover component

**Files:** `web/src/components/Popover.vue` (new)

**Step 6.1 — Implement**

- A trigger slot and a panel slot. Internal `open` ref toggled by trigger click.
- Closes on outside click (document listener added on open, removed on close /
  unmount) and on Escape.
- Floating panel positioned relative to the trigger (absolute, sensible offset).
  Dark-aware styling, subtle shadow/border.

**Step 6.2 — Verify**

`npm run build` clean.

---

## Task 7: Sidebar rewrite

**Files:** `web/src/components/Sidebar.vue` (rewrite)

**Step 7.1 — Props/emits**

- Props: `calendars`, `tags`, `connected`, `enabledCalendarIds`, `selectedTag`.
- Emits: `toggle-calendar`, `set-all`, `select-tag`, `add-calendar(name)`,
  `rename-calendar(id, name)`, `recolor-calendar(id, color)`, `add-tag(name,
  color)`, `rename-tag(id, name)`, `recolor-tag(id, color)`, `delete-tag(id)`.
- **No** `remove`/calendar-delete emit anywhere.

**Step 7.2 — Calendars section**

- Each row: visibility checkbox + color dot + name + `⋯` `Popover`. Popover
  content: a rename input (emits `rename-calendar`) and a `ColorPicker` (emits
  `recolor-calendar`). Keep "Select all/none".

**Step 7.3 — Tags section**

- `＋` row to add (name + `ColorPicker` → `add-tag`).
- Each tag: filter chip (click → `select-tag`, active state highlighted) + `⋯`
  `Popover` with rename input, `ColorPicker`, and a Delete button that confirms
  before emitting `delete-tag`.
- "(no tags)" empty state.

**Step 7.4 — Styling**

Apply the new visual system: section headers, spacing, rounded rows, hover, dark
variants, emerald active states. Live indicator at the bottom.

**Step 7.5 — Verify**

`npm run build` clean (views still pass old props until Task 9/10 — do 7→10 as a
unit if the intermediate build breaks).

---

## Task 8: EventModal rewrite (create/view/edit + tags)

**Files:** `web/src/components/EventModal.vue` (rewrite)

**Step 8.1 — Props/emits**

- Props: `mode: "create" | "view" | "edit"`, `event: Event | null`,
  `calendars`, `tags`.
- Emits: `close`, `create(input, tagIds: string[])`,
  `save(id, updates, tagIds: string[])`.

**Step 8.2 — Modes**

- `create`: empty form (default calendar = first); Save emits `create`.
- `view`: read-only details incl. tag chips; Edit switches to edit; Close.
- `edit`: title, calendar select, all-day checkbox (toggles date vs datetime
  inputs), start/end, location, description, **tag toggle chips** (clicking
  toggles membership in a local `Set`). Save emits `save` with the chosen tag ids.

**Step 8.3 — Error handling**

Wrap save/create in try/catch; show an inline error string and keep the modal
open on failure (e.g. duplicate-name 409 is not expected here, but API/validation
errors are).

**Step 8.4 — Styling**

Overlay + centered card per the new system; dark-aware; emerald primary buttons;
Escape + overlay-click close.

**Step 8.5 — Verify**

`npm run build` (after Task 9/10 wire it up).

---

## Task 9: CalendarView integration

**Files:** `web/src/views/CalendarView.vue` (edit)

**Step 9.1 — Wire managers**

- Use `useCalendars` (with `update`, no `remove`), `useTags` (create/update/
  remove), `useEvents` (create/update/addTag/removeTag).
- Pass new props to `Sidebar`; handle all new emits:
  - `rename-calendar`/`recolor-calendar` → `cals.update(id, {...})`.
  - `add-tag`/`rename-tag`/`recolor-tag`/`delete-tag` → `tags.*`.

**Step 9.2 — Event modal lifecycle**

- State `modalMode: "create"|"view"|"edit"|null` and `selected: Event|null`.
- `＋ New event` button (emerald, in the calendar toolbar area) → `create`.
- `onEventClick` → find full event → `view`.
- Handle `create(input, tagIds)`: `events.create(input)` then for each tagId
  `events.addTag(newId, tagId)` then `refresh()`. (Create returns the event — use
  its id; if `useEvents.create` doesn't return it, adjust it to return the
  created event.)
- Handle `save(id, updates, tagIds)`: `events.update(id, updates)`, diff tags vs
  `event.tags` (by name→id), add/remove via `events.addTag/removeTag`, then
  `refresh()`; close modal.

**Step 9.3 — Colors + filters**

Keep the existing per-calendar color sync (internal signal cast), calendar/tag
filter watches. Remove `EventForm` usage/import.

**Step 9.4 — Verify**

`npm run build` clean.

---

## Task 10: ListView integration

**Files:** `web/src/views/ListView.vue` (edit)

**Step 10.1 — Mirror CalendarView**

- Same composable wiring, Sidebar props/emits, and modal lifecycle
  (create/view/edit, tag diff on save).
- Keep search + client-side calendar filter + server-side tag filter.
- Rows: calendar color dot + title + datetime + tag chips + location; clicking a
  row opens `view`. `＋ New event` opens `create`. Remove `EventForm`.

**Step 10.2 — Styling**

Apply the new visual system to rows (rounded, hover, dark variants).

**Step 10.3 — Verify**

`npm run build` clean.

---

## Task 11: App shell + cleanup

**Files:** `web/src/App.vue` (edit), `web/src/components/EventForm.vue` (delete),
`web/src/composables/useSSE.ts` (edit)

**Step 11.1 — App.vue**

Restyle the top bar to the new system (brand, Calendar/List switch with active
state, logout). Ensure the `dark` class drives backgrounds/text. Keep the pair
route bare.

**Step 11.2 — Remove EventForm**

Delete `web/src/components/EventForm.vue` and confirm no remaining imports
(`grep`).

**Step 11.3 — SSE listener**

Add `"tag.updated"` to the `CHANGE_EVENTS` list in `useSSE.ts` so tag recolors
from any client refresh the UI.

**Step 11.4 — Verify**

```bash
cd web && npm run build
```

Expected: clean; no dangling `EventForm`/`deleteCalendar` references.

---

## Task 12: Full verification

**Step 12.1 — Automated**

```bash
npm test          # backend, incl. new tag-update tests
npm run build     # backend tsc + web vue-tsc/vite
```

Both green.

**Step 12.2 — Manual (`npm run dev` + `npm --prefix web run dev`)**

- Redesigned shell; light/dark follows OS; emerald accents.
- No delete control on calendars anywhere.
- Calendar `⋯` → rename + recolor; updates live in sidebar and grid.
- Tag `＋` add; tag `⋯` → rename / recolor / delete (confirm); chip click filters.
- `＋ New event` opens empty modal; create works; assigned tags persist.
- Click event → view → Edit → Save persists; tag toggles apply.
- List view mirrors all of the above; search works alongside filters.
- SSE: a change in one view/client refreshes the other.

---

## Files summary

| File | Action |
|------|--------|
| `src/schemas/tag.ts` | Add `UpdateTagSchema` / `UpdateTagInput` |
| `src/services/tag.service.ts` | Add `update()` (emits `tag.updated`) |
| `src/services/tag.service.test.ts` | Add update tests (TDD) |
| `src/rest/tags.ts` | Add `PATCH /tags/{id}` |
| `src/rest/app.test.ts` | Add PATCH route test |
| `web/src/api/client.ts` | +updateCalendar, tag CRUD, event-tag assign; −deleteCalendar |
| `web/src/composables/useCalendars.ts` | +update; −remove |
| `web/src/composables/useTags.ts` | +create/update/remove |
| `web/src/composables/useEvents.ts` | +addTag/removeTag; create returns event |
| `web/src/composables/useTheme.ts` | **New** — auto dark mode |
| `web/src/composables/useSSE.ts` | + `tag.updated` |
| `web/src/style.css` | Tokens, dark variant, Schedule-X reskin |
| `web/src/components/ColorPicker.vue` | **New** |
| `web/src/components/Popover.vue` | **New** |
| `web/src/components/Sidebar.vue` | Rewrite (calendar/tag management, no delete) |
| `web/src/components/EventModal.vue` | Rewrite (create/view/edit + tags) |
| `web/src/components/EventForm.vue` | **Delete** |
| `web/src/views/CalendarView.vue` | Modal lifecycle, managers, no EventForm |
| `web/src/views/ListView.vue` | Modal lifecycle, managers, enhanced rows |
| `web/src/App.vue` | Restyled shell |
| `web/src/main.ts` | Init theme |
