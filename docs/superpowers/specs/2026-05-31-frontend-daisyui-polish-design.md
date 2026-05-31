# Frontend Polish: DaisyUI, Theme Toggle, Responsive Design

Date: 2026-05-31
Status: Approved

## Problem

After the 2026-05-30 redesign, the user reported four issues with the web UI:

1. **No light mode.** The theme strictly follows the OS `prefers-color-scheme`
   with no manual override, so a user whose OS is dark is locked into dark.
2. **Not responsive.** The layout (fixed ~14rem sidebar + content) does not
   adapt to phone widths.
3. **Calendar still looks bad.** The Schedule-X grid, even reskinned, looks
   unpolished.
4. **Black text in dark mode.** Some text stays dark/near-black in dark mode
   (elements missing `dark:` variants and/or Schedule-X internals using
   non-overridden colors).

The user also asked whether to adopt a UI library. Decision: **yes — DaisyUI**.

## Goals

- A manual **light / dark / system** theme toggle, persisted, defaulting to
  system.
- A **responsive** layout that works on phones (sidebar becomes a drawer).
- A consistent, polished look via **DaisyUI** semantic components/colors.
- Fix dark-mode contrast so no text is unreadable in either theme.
- Reskin the Schedule-X calendar to track the active theme and look clean.

## Non-Goals (YAGNI)

- A multi-theme picker (only light / dark / system).
- Replacing Schedule-X with a from-scratch calendar (kept this round; revisit
  separately if reskinning is insufficient).
- Any backend change (this is frontend-only; the backend's 66 tests are
  unaffected).
- New event/calendar/tag features beyond what already exists.

## Decision: why DaisyUI

DaisyUI v5 is a Tailwind v4 plugin (pure CSS classes + a theme system), so it
layers onto the existing Tailwind setup with minimal disruption and no heavy JS
runtime. Its semantic color tokens (`base-100/200/300`, `base-content`,
`primary`, …) invert automatically per theme, which directly fixes the
light/dark toggle (#1) and the stray dark-mode text (#4), and its `drawer`
component gives responsive sidebar behavior (#2) cheaply. A big all-in-one
library (PrimeVue/Naive/Element) was rejected as overkill that fights Tailwind.
A UI library cannot fix the calendar (#3) — that is third-party Schedule-X and
needs CSS tuning regardless.

## Architecture

### Theming (`style.css`, `useTheme.ts`, top bar)

- `style.css`: after `@import "tailwindcss";`, add `@plugin "daisyui";` and
  define a **custom light theme and dark theme** (emerald primary, neutral/slate
  base) via DaisyUI's theme config. Keep the existing `@custom-variant dark` so
  residual `dark:` utilities still work.
- `useTheme.ts`: replace the OS-only singleton with a 3-mode store:
  - `mode: Ref<"light" | "dark" | "system">`, initialized from
    `localStorage["theme"]` (default `"system"`).
  - `setMode(mode)` persists to `localStorage` and re-applies.
  - `apply()` resolves the effective theme (in `system` mode, from
    `matchMedia("(prefers-color-scheme: dark)")`), then sets `data-theme`
    (`"light"`/`"dark"` custom theme names) on `<html>`, toggles the `.dark`
    class, and sets `color-scheme`.
  - The `matchMedia` `change` listener only re-applies while `mode === "system"`.
  - `initTheme()` runs once from `main.ts` (already wired).
- Top bar: a small **Light / Dark / System** control bound to `setMode`
  (segmented buttons or a dropdown), with an indication of the active mode.

### Components (DaisyUI restyle)

Restyle with DaisyUI classes/tokens; keep existing Vue logic except where noted.

- **`App.vue`**: `navbar` (brand, Calendar/List links, theme control, logout),
  wrapped in a DaisyUI **`drawer`** (see Responsive).
- **`Sidebar.vue`**: DaisyUI list/menu styling; calendars and tags use semantic
  colors. The `⋯` menus keep the custom **`Popover`** (DaisyUI's CSS dropdown
  closes on blur, which fights the native `<input type="color">`). Add-forms use
  DaisyUI `input`/`btn`.
- **`EventModal.vue`**: DaisyUI `modal`/`modal-box` styling and form controls
  (`input`, `select`, `textarea`, `checkbox`), tag chips as `badge`s, `btn`
  actions. **Keep** the Vue-controlled open/close + `defineExpose({ setError })`.
- **`ColorPicker.vue`**, **`Popover.vue`**: restyle with DaisyUI tokens; logic
  unchanged.
- **`ListView.vue`**: rows, search input, buttons in DaisyUI; rows use
  `base-content`/`base-200` so contrast is theme-correct.
- **`PairView.vue`**: restyle the (currently bare) pairing screen with DaisyUI
  `card`/`input`/`btn` for consistency and dark support.

### Responsive (DaisyUI `drawer`)

- Wrap the app in a DaisyUI **`drawer`**: the sidebar is the drawer side, static
  on `lg+` (`lg:drawer-open`), and a slide-in panel on smaller screens toggled by
  a **hamburger** button in the navbar.
- Navbar compacts on mobile; nav links stay reachable.
- `EventModal` is near-full-width and vertically scrollable on small screens.
- View toolbars (the `＋ New event` row, ListView search row) stack on narrow
  widths.
- The calendar area fits narrow widths via reduced padding and horizontal scroll
  where Schedule-X overflows.

### Calendar reskin (Schedule-X)

- In `style.css`, map the Schedule-X `--sx-*` variables (scoped to
  `.sx-vue-calendar-wrapper`) to **DaisyUI token references**, e.g.
  `--sx-color-background: var(--color-base-100)`,
  `--sx-color-surface: var(--color-base-100)`,
  surface containers → `--color-base-200`/`base-300`,
  `--sx-color-on-background`/`on-surface` → `var(--color-base-content)`,
  `--sx-color-primary` → `var(--color-primary)`,
  `--sx-color-on-primary` → `var(--color-primary-content)`,
  borders/outlines → a base-300/neutral token.
  Because these are live `var()` references, the calendar **auto-tracks the
  active theme** — the separate `.dark .sx-vue-calendar-wrapper` block is no
  longer needed.
- Tune spacing, font, the "today" highlight, event-chip styling, and header
  controls for a cleaner look.
- Per-calendar event colors keep the existing internal-signal sync in
  `CalendarView.vue` (unchanged).

## Data Flow

Unchanged. Theme state lives in the `useTheme` singleton and `localStorage`;
nothing else changes. No new network calls.

## Error Handling

Unchanged from current behavior. `EventModal` keeps inline error display via
`setError`. The theme store reads/writes `localStorage` defensively (ignore
read/parse failures, fall back to `system`).

## Testing

- **Backend:** unchanged; `npm test` stays green (no backend edits).
- **Frontend:** `npm run build` (vue-tsc + vite) stays clean. **Biome** stays
  clean — verify its CSS parser tolerates `@plugin` (with `tailwindDirectives`
  already enabled); if not, scope `style.css` out of CSS parsing or adjust
  config.
- **Manual (required, proves #1–#4):** with `npm run dev` +
  `npm --prefix web run dev`:
  - Theme control switches light / dark / system; choice persists across reload;
    `system` follows the OS live.
  - At phone width, the sidebar is a hamburger-toggled drawer; navbar, modal, and
    toolbars adapt; no horizontal overflow of the chrome.
  - The calendar looks clean and matches the theme in both light and dark.
  - No unreadable/black text in dark mode anywhere (chrome and calendar).

## Verification

1. `npm run build` — vue-tsc + vite build clean.
2. `npx biome check` — no new errors.
3. `npm test` — backend suite still green (sanity).
4. Manual browser pass per the Testing section.

## Risks

- **DaisyUI v5 + Tailwind v4 integration / version pin** — confirm the `@plugin`
  setup and theme config syntax against the installed version at implementation
  time.
- **Biome `@plugin` parsing** — may need a config tweak (see Testing).
- **Schedule-X polish ceiling** — reskinning may not fully satisfy #3; if so,
  replacing the calendar is a separate, larger effort (out of scope here).
