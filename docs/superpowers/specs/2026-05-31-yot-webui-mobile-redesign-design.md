# yot Web UI — Mobile-First Redesign

**Date:** 2026-05-31
**Status:** Approved (design)
**Area:** `web/` (Vue 3 + Vite + Tailwind v4 + DaisyUI v5 + Schedule-X)

## Problem

The mobile experience has four issues:

1. **Calendar and List tabs are redundant on mobile.** The Calendar tab falls back to `AgendaList` (a day-grouped scrollable list) and the List tab is a flat card list — both are "a list of events."
2. **Tags can only be created from the sidebar**, not while creating an event.
3. **`EventModal` is hand-rolled**, not built from DaisyUI components.
4. **The mobile sidebar** (a slide-in overlay) feels heavy.

Plus an overall complaint: the UI "looks too AI-made." The root cause is uniform bordered cards (`card border border-base-300` everywhere), no real type hierarchy, and a generic default palette.

## Goals

- Mobile **Calendar** tab = a real month/week grid. Mobile **List** tab = the day-grouped agenda list.
- Create a new tag inline from the new-event modal.
- Rebuild `EventModal` on DaisyUI primitives.
- Remove the mobile sidebar; move filtering + calendar/tag management into a bottom sheet.
- Restyle the whole app into a **borderless "editorial"** language that reads as hand-built.

## Decisions (resolved during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Mobile filtering & calendar/tag management | **Bottom sheet** (DaisyUI `modal-bottom`) opened from a header **Filter** button | Clean main screen, filtering one tap away, management in the same place |
| Mobile Calendar tab | **Month grid with per-day dots + tapped-day agenda**; Month/Week toggle | Native phone pattern, big tap targets, looks intentional |
| Visual direction | **Editorial calm, borderless** — warm paper bg, ink text, serif headings/dates, hairline dividers, deep emerald accent | User: visible borders/boxed cards "look AI made"; wants hand-built feel |
| Restyle scope | **Whole app** (mobile + desktop) | Cohesion |
| Fonts | Self-hosted **Instrument Serif** (display) + **Inter** (UI) via `@fontsource` | Distinctive type hierarchy; offline-capable PWA |

**Borderless rule (applies to all UI below):** replace bordered cards with whitespace, `divide-y divide-base-200` hairlines, and subtle `base-200` background separation. Borders/shadows only for genuine elevation (the bottom sheet, dropdowns, the modal), never as default decoration.

## Component & file design

### 1. Visual foundation — `web/src/style.css`
- Rewrite the two `@plugin "daisyui/theme"` blocks:
  - **light:** `--color-base-100` warm paper (≈ stone-50), `--color-base-200`/`-300` warm hairline tones, `--color-base-content` warm ink (≈ stone-900), `--color-primary` deep emerald (≈ `oklch(0.55 0.12 163)`), `--depth: 0`, `--noise: 0`.
  - **dark:** warm-tinted near-black surfaces (not cool slate), brighter emerald primary, same radii/depth.
- Keep the existing Schedule-X variable mapping; soften its grid lines toward `base-200`.
- Set the default UI font to Inter and add a `font-serif` family (Instrument Serif) used for headings, month/date labels, the wordmark, and modal titles.

### 2. Fonts — `web/package.json` + entry
- Add deps `@fontsource/instrument-serif` and `@fontsource/inter`.
- Import the needed weights in `web/src/main.ts` (or `style.css`). Map Tailwind `font-sans` → Inter, `font-serif` → Instrument Serif.

### 3. App shell — `web/src/App.vue`
- Sidebar toggle button becomes desktop-only (`hidden lg:inline-flex`); on mobile there is no sidebar to toggle.
- Borderless header: drop `border-b` (optionally a single hairline), serif `yot` wordmark.
- `BottomDock` unchanged structurally (mobile nav); restyled to match.

### 4. Shared filters — `web/src/components/FiltersPanel.vue` (new)
- Extract the **Calendars** and **Tags** sections currently inside `Sidebar.vue`: calendar checkboxes + All/None, add-calendar, per-calendar rename/recolor; tag filter chips, add-tag, per-tag rename/recolor/delete, live indicator.
- Props/emits mirror today's Sidebar contract so both consumers below pass through.
- Restyled borderless (menu rows with hairline separation, no boxed dropdown panels beyond necessary elevation).

### 5. Desktop sidebar — `web/src/components/Sidebar.vue`
- Becomes a thin docked wrapper around `FiltersPanel` (keeps the desktop collapse behavior via `useSidebar`).

### 6. Mobile bottom sheet — `web/src/components/FilterSheet.vue` (new)
- DaisyUI `modal modal-bottom`; content = `FiltersPanel` (same props/emits).
- Open/close state lives in a small shared `useFilterSheet` composable (singleton ref, mirroring `useSidebar`) so the **Filter** button in both the Calendar and List mobile headers drives one sheet consistently.

### 7. Mobile calendar — `web/src/components/MobileCalendar.vue` (new)
- Props: `events`, `calendars`, `tags`. Emits: `open(event)`, `create(prefill)`.
- **Month/Week** segmented toggle.
- **Month:** weekday header row; 7-col date grid for the visible month (leading/trailing days muted); each day cell shows up to 3 colored dots (calendar colors) for that day's events; prev/next month nav; today outline + selected-day fill. Tapping a day selects it and renders that day's time-ordered events below (reusing a compact event row). Tapping a day with no events can emit `create` with an all-day prefill for that date.
- **Week:** horizontal weekday strip for the selected week (dates, dots); selecting a day lists its time-ordered events below.
- Used in `CalendarView` mobile branch in place of `AgendaList`.

### 8. Calendar view — `web/src/views/CalendarView.vue`
- Desktop: unchanged Schedule-X grid, restyled controls (toolbar instead of a bordered card; softened frame).
- Mobile: render `MobileCalendar` (was `AgendaList`) + a mobile header with the **Filter** button; mount `FilterSheet`.

### 9. List view — `web/src/views/ListView.vue`
- Render the day-grouped `AgendaList` as the event list on all sizes (removes the duplicate flat card list).
- Keep the search input; add a **Filter** button (mobile) that opens `FilterSheet`. Desktop keeps the docked `Sidebar`.

### 10. Agenda list — `web/src/components/AgendaList.vue`
- Restyle borderless: sticky serif day headers, event rows separated by hairline dividers and a calendar-color accent stripe, no `card border` boxes.

### 11. Event modal — `web/src/components/EventModal.vue`
- Rebuild with DaisyUI primitives: `modal`/`modal-box` (serif title), `fieldset` + `label` + `input`/`select`/`textarea`, `checkbox` for all-day, `modal-action` buttons. View mode restyled borderless.
- **Inline tag creation:** the Tags section gains a **"+ New tag"** control that reveals an inline name input + `ColorPicker`. On submit it creates the tag and **auto-selects** it.
  - Wiring: `useTags.create()` returns the created `Tag`. The parent view passes an async function prop `:create-tag="(name, color) => createTag(name, color)"`; the modal does `const t = await props.createTag(...)` and adds `t.id` to `selectedTagIds`.

### 12. Tags composable — `web/src/composables/useTags.ts`
- `create(name, color)` returns the created `Tag` (still reloads the list).

## Data flow notes
- Filtering state stays in the shared `useFilters` singleton; `FiltersPanel` is purely presentational and emits the same events Sidebar emits today, so behavior is unchanged on desktop and identical inside the mobile sheet.
- `MobileCalendar` groups the already-filtered `visibleEvents` by local day key (reuse the existing `dayKey` logic from `AgendaList`).
- Inline tag creation reuses the existing `addEventTag` flow after the event is created (create-mode tags are still applied after `addEvent`).

## Edge cases
- Month grid spans 5–6 week rows depending on the month; compute the grid from the first weekday of the month through the last, padded to full weeks.
- Day with more events than dots shown: cap dots (e.g., 3) — the tapped-day list shows all.
- Empty states: month with no events still renders the grid; tapped day with none shows a quiet "No events" line.
- Creating a tag with a duplicate name surfaces the API error inside the modal (existing `setError` path).
- Dark mode verified for new components and the bottom sheet.

## Verification
- `npm run build` (runs `vue-tsc --noEmit`) — type-clean.
- Biome lint/format pass.
- Manual browser check at mobile (≤640px) and desktop (≥1024px), light **and** dark:
  - Calendar tab month/week grid, day selection, event open, empty-day create.
  - List tab agenda + search + filter sheet.
  - Filter sheet: calendar toggles, tag filter, add/rename/recolor/delete.
  - Event modal create/edit/view + inline tag creation auto-selects.
  - No sidebar or hamburger on mobile; sidebar intact on desktop.

## File inventory
**New:** `web/src/components/MobileCalendar.vue`, `web/src/components/FilterSheet.vue`, `web/src/components/FiltersPanel.vue`, `web/src/composables/useFilterSheet.ts`.
**Modified:** `web/src/style.css`, `web/src/main.ts`, `web/package.json`, `web/src/App.vue`, `web/src/components/Sidebar.vue`, `web/src/components/BottomDock.vue`, `web/src/components/AgendaList.vue`, `web/src/components/EventModal.vue`, `web/src/views/CalendarView.vue`, `web/src/views/ListView.vue`, `web/src/composables/useTags.ts`.

## Out of scope
- Backend/API changes (the tag/event/calendar endpoints already support everything needed).
- Drag-to-create / drag-to-reschedule on the mobile grid.
- Desktop Schedule-X view changes beyond restyle.
