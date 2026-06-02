# Cover section — design

**Date:** 2026-06-02
**Status:** Approved (brainstorm), ready for implementation plan

## Goal

Recreate the cover/gallery face of the upcoming-events list as an **editorial
landscape mosaic**: image-forward cards where the soonest event anchors the view
and information-rich events get a larger footprint. Two hard requirements from
the user drive the look:

1. A **uniform dark mask over the whole image** (a flat semi-transparent black
   layer covering each entire image) so white text stays readable — *not* a
   bottom-anchored gradient scrim.
2. **Layout contrast by size, not colour**: bigger cards for more important
   events, compact for the rest, in a non-identical arrangement that does **not**
   read as a simple repeating pattern.

Built with Vue 3 + Tailwind v4 + **daisyui** (used wherever it fits). Borderless
(no card borders — matches the user's editorial preference).

## Where it lives

The cover view previously existed and was removed (commit `f6f3ac4`). This work
restores it, reusing the existing plumbing:

- **New:** `web/src/components/CoverGrid.vue` — presentational grid.
- **New:** `web/src/components/cover-card-layout.ts` — pure layout/importance logic.
- **New:** `web/test/cover-card-layout.test.ts` — unit tests for the logic.
- **Restore:** `/cover` route in `web/src/router.ts` (lazy-loads `ListView.vue`).
- **Restore:** `coverMode` branch in `web/src/views/ListView.vue` (renders
  `CoverGrid` when the route is `cover`, else `AgendaList`).
- **Restore:** "Cover" nav links in `web/src/App.vue` (desktop) and
  `web/src/components/BottomDock.vue` (mobile), using the `Images` lucide icon.
- **Reuse, unchanged:** `Event` type and `imageSrc()` from `web/src/api/client.ts`.

No backend changes. The data source is the same `events` + `calendars` already
passed to `ListView`.

## Data shown

Same selection as the old cover: events from **today onward, soonest first**.
`Event` fields available: `title`, `description`, `location`, `start_at`,
`end_at`, `all_day`, `image_path`, `url`, `tags[]`, `calendar_id`.

## Visual design

- **Cards** are landscape images with the photo full-bleed behind the content.
- **The mask**: one flat overlay of ~`rgba(0,0,0,0.45)` (`bg-black/45`) across the
  entire card — the readability layer between image and text. No gradient.
- **Text** sits bottom-left over the mask: the **title** (weight by tier), a
  **meta line** (`when` + optional `location`), and small chips for **calendar
  name** and the **first tag** where the card has room. White text with a soft
  text-shadow for extra legibility.
- **No image** → fall back to a gradient from the calendar colour (as before,
  via `color-mix`), with the same dark mask on top so text stays readable.
- **Borderless**: separation comes from the gap + shadow, not borders. Hover
  raises shadow with a subtle motion-safe lift; focus shows an outline ring.

## Card tiers (size = importance)

Three tiers, assigned in `cover-card-layout.ts`:

| Tier | Who | Footprint | Detail shown |
|------|-----|-----------|--------------|
| **hero** | the soonest event (`index === 0`) | largest landscape block (~16:9), spans 2 columns | calendar chip, tag, title, meta |
| **feature** | "important" events (see below) | larger landscape (~2:1), spans 2 columns | calendar chip, tag, title, meta |
| **normal** | everything else | standard landscape (~3:2), spans 1 column | title, meta |

`hero` and `feature` both span two columns so they stay clearly larger than
`normal` cards, but they are sized to read **landscape** and must **never become
a thin full-bleed band** (the user explicitly rejected "superwide" strips). On
wide screens the grid gains columns so a two-column span is prominent without
spanning the entire width.

## "Important" + the non-repeating rule

The point is contrast that looks **organic, not mechanical**. Two inputs:

1. **Richness score** (content depth):
   - `image_path` → +2
   - `description` → +1
   - `location` → +1
   - `tags.length > 0` → +1
   - `url` → +1
   An event is **eligible** to be a `feature` only if it **has an image** and
   `richness >= 3`. (A big card needs a good photo; image-less events stay
   `normal` with the colour-gradient fallback.)

2. **Deterministic per-event jitter**: a stable hash of `event.id` maps to a
   value in `[0, 1)`. Eligible events are promoted to `feature` only when their
   jitter value passes a promotion threshold, **and** a **minimum-spacing rule**
   holds (at least N `normal` cards since the last `feature`, N ≈ 2). This:
   - breaks any fixed every-Nth cadence (jitter, not position, decides),
   - prevents two big cards clustering (spacing),
   - is **stable across renders** (same id → same result), so the layout doesn't
     reshuffle on every data refresh.

The hero is always the soonest event regardless of richness.

## Layout mechanics

- A CSS grid with **fixed row height + column/row spans** and
  `grid-auto-flow: dense`, so the varied tile sizes **pack without gaps**.
- Responsive column count: **2 columns on phones**, increasing on larger
  screens (e.g. 2 → 3 → 4). Tier spans scale with the breakpoint so big cards
  stay landscape and never thin out into a band.
- Generous, airy gaps.
- Exact row heights, span values, gap sizes, breakpoints, promotion threshold,
  and spacing N are tuning details for the implementation plan.

## daisyui usage

- Card container uses the daisyui `card` class and `rounded-box` token.
- Calendar / tag chips use `badge` / `badge-sm`.
- Colours via daisyui tokens (`bg-primary`, `text-primary-content`, base tokens).
- The dark mask is a hand-rolled overlay element: daisyui's only scrim primitive
  (`hero-overlay`) is a single flat overlay tied to the `hero` component and not
  a fit for per-card image tiles, but the uniform mask we want **is** just a flat
  overlay, so this stays minimal.

## Accessibility & performance

- White text over `black/45` (plus text-shadow) — verify ≥ 4.5:1 on
  representative images; the mask guarantees a dark floor.
- Decorative layers (`image`, `mask`) are `aria-hidden`; the card is a real
  `<button>` whose accessible name is the visible title.
- Focus-visible outline ring; hover/lift under `motion-safe:` and reduced-motion
  respected.
- **Out of scope (noted):** media currently loads as CSS `background-image`, so
  cards aren't lazy-loaded. Acceptable for now; a future pass could switch to
  `<img loading="lazy">`. Not part of this change.

## Components & interfaces

- **`cover-card-layout.ts`** (pure, no Vue) — the testable core:
  - `richness(event): number`
  - `coverCardLayout(event, index, ctx)` → `{ tier, className, showCalendar, showLocation }`
    where `ctx` carries the running state needed for the jitter/spacing rule
    (e.g. count of normal cards since the last feature). Deterministic.
- **`CoverGrid.vue`** — presentational: takes `events` + `calendars`, computes
  the per-event layout once (threading `ctx`), and renders tiles. Emits `open`
  on click (unchanged contract with `ListView`).

This keeps the arrangement logic isolated and unit-testable, with the Vue
component thin and focused on markup.

## Testing

Unit tests for `cover-card-layout.ts`:

- `richness` adds the documented weights.
- Hero is always `index === 0`.
- Image-less events never become `feature`.
- `feature` promotion respects the spacing rule (no two adjacent).
- Same `event.id` yields the same tier across runs (determinism).
- A run of equally-rich events does **not** produce a fixed alternating pattern.

## Out of scope

- Backend / API changes (none).
- Image lazy-loading refactor (future).
- Changes to `AgendaList` or the calendar views.
