# Per-view filter settings

**Date:** 2026-06-03
**Status:** Approved (design)

## Problem

The Calendar, List, and Cover views share a single set of filter settings. Toggling
a calendar off (or selecting a tag, or typing a search) in one view changes what every
other view shows. The user wants each view to remember its own filter settings
independently — e.g. show all events on the Calendar while showing only a few on Cover.

"Cover" and "List" are both served by `ListView.vue` (one component instance, the route
name flips `coverMode`), so they currently share state too and must also be decoupled.

## Current state

Three filter inputs feed the visible event set:

| Filter | Mechanism today | Source of sharing |
|---|---|---|
| Calendar checkboxes | client-side (`applyCalendarFilter`) | `useFilters` module singleton |
| Selected tag | **server-side** refetch (`?tag=`) | singleton + shared `events` store |
| Search text | **server-side** refetch (`?q=`) | `ListView` local ref + shared `events` store |

- `useFilters()` (web/src/composables/useFilters.ts) holds `enabledCalendarIds` (Set) and
  `selectedTag` as module-level refs — one shared instance across all views.
- `useEvents()` (web/src/composables/useEvents.ts) holds one shared `events` ref, loaded
  via `api.listEvents(query)`.
- Server `GET /events` (src/services/event.service.ts `list`): `q` matches
  `title LIKE %q% OR description LIKE %q%` (SQLite `LIKE`, case-insensitive for ASCII);
  `tag` joins on tag name; results are `ORDER BY start_at` with `limit` default **50**,
  max **500**.

Because `tag` and `q` are applied server-side into the single shared `events` array, two
views cannot hold differently-filtered sets simultaneously. True independence therefore
requires moving tag and search filtering to the client.

## Chosen approach

**Per-view filter state, with all filtering done client-side over one broadly-fetched
event set.**

The calendar-checkbox filter already works client-side; this extends the same model to
tag and search, and namespaces all three by view ("scope").

### Scopes

```
type FilterScope = "calendar" | "list" | "cover";
```

- `CalendarView` uses the fixed scope `"calendar"`.
- `ListView` uses a **reactive** scope derived from the route:
  `computed(() => route.name === "cover" ? "cover" : "list")`. `ListView` is a single
  instance shared by `/list` and `/cover`, so the scope must be reactive — no remount.

### `useFilters(scope)` rewrite

`web/src/composables/useFilters.ts` becomes scope-aware. `scope` may be a literal
`FilterScope` or a `Ref<FilterScope>` (normalized internally with `isRef`/`ref`).

Module-level state:

```
type ScopeState = {
  enabledCalendarIds: Ref<Set<string>>;
  selectedTag: Ref<string | null>;
  search: Ref<string>;
};
const scopes = new Map<FilterScope, ScopeState>();
const knownCalendarIds = new Set<string>(); // calendars seen so far, global
```

- **Lazy init:** `stateFor(scope)` creates a `ScopeState` on first access, initializing
  `enabledCalendarIds` to `new Set(knownCalendarIds)` (every currently-known calendar
  enabled by default), `selectedTag = null`, `search = ""`.
- **Returned reactivity is scope-tracking.** The composable returns computeds/writable
  computeds that read `stateFor(currentScope.value)`, so when `ListView`'s scope flips
  between `list` and `cover`, the bound values switch to that scope's state with no
  remount:
  - `enabledCalendarIds` → `computed(() => stateFor(scope.value).enabledCalendarIds.value)`
  - `selectedTag` → `computed(() => stateFor(scope.value).selectedTag.value)`
  - `search` → **writable** computed (get/set) so it can be `v-model`-bound.
- **Mutators** operate on the current scope: `toggleCalendar(id)`, `setAllCalendars(bool)`,
  `setTag(name)`. `setSearch` is unnecessary because `search` is a writable computed
  bound with `v-model`.
- **`syncCalendars(ids)`** maintains `knownCalendarIds` and every existing scope's set:
  - For each incoming id not in `knownCalendarIds`: add to `knownCalendarIds` and add to
    **every** existing scope's `enabledCalendarIds` (new calendars default-enabled
    everywhere).
  - For each known id no longer present: remove from `knownCalendarIds` and from every
    scope's `enabledCalendarIds`.
- **`applyFilters(events)`** (replaces `applyCalendarFilter`) filters by the current
  scope's three inputs, client-side:
  - calendar: `enabledCalendarIds.has(e.calendar_id)`
  - tag: no tag selected, or `e.tags.includes(selectedTag)`
  - search: empty, or `e.title` / `e.description` (lowercased) includes the lowercased
    query — mirrors the server's `title/description LIKE`.
- `buildQuery()` is removed (no server-side tag/q).

### Event fetching

- `useEvents().load()` defaults its query to `{ limit: "500" }` (one place, commented).
  Both views call `loadEvents()` with no filter args.
- Server filtering by tag/q is dropped from the client entirely.

### View changes

`CalendarView.vue`:
- `useFilters("calendar")`.
- `visibleEvents = computed(() => applyFilters(events.value))`.
- Event-load job becomes `loadEvents()` (no `buildQuery()`).
- Remove `watch(selectedTag, () => refresh("event"))` — tag is client-side now.

`ListView.vue`:
- `const scope = computed(() => route.name === "cover" ? "cover" : "list")`;
  `useFilters(scope)`.
- `search` comes from `useFilters` (writable computed), `v-model`-bound to the search box.
  Search filters **live** as the user types. The existing Search button / Enter handler
  remain as affordances but no longer trigger a fetch.
- `visibleEvents = computed(() => applyFilters(events.value))`.
- Event-load job becomes `loadEvents()`; remove `query()`, `buildQuery`, and
  `watch(selectedTag, ...)`.

`Sidebar.vue` / `FilterSheet.vue` / `FiltersPanel.vue`: no change. They are stateless
(props in, events out) and receive the now scope-reactive `enabledCalendarIds` /
`selectedTag`.

## Data flow after change

```
api.listEvents({limit:500})  ──►  useEvents.events (shared, full set)
                                          │
                 per active view: applyFilters(events) using that scope's state
                                          │
              CalendarView / ListView(list) / ListView(cover)  → independent visible sets
```

SSE / mutation refreshes reload the full set (`loadEvents()`); each view re-derives its
own filtered view reactively. No refetch on view switch or filter change.

## Behavior changes (accepted)

1. **Search is client-side and live** (filters per keystroke) instead of a server refetch
   on Enter. Same matching fields (title, description).
2. **Tag filter is client-side.**
3. **Fetch window 50 → 500** so client-side filtering has enough events. 500 is the
   server's max page size.

## Out of scope / known limitations

- **No cross-reload persistence.** Filter state is in-memory (module singleton) and resets
  on a full page reload — same as today. localStorage persistence is not part of this work.
- **500-event ceiling.** `GET /events` returns at most 500 rows ordered by `start_at`
  ascending; client-side filtering operates within that window. This is a pre-existing
  limitation (it was 50) and pagination/range-fetching is not addressed here.

## Testing

- Unit-test `useFilters` scope isolation: toggling a calendar / setting a tag / setting
  search in one scope does not affect another; new calendars from `syncCalendars`
  default-enabled in all scopes; removed calendars drop from all scopes.
- Unit-test `applyFilters`: calendar + tag + search combine correctly; empty inputs are
  no-ops; search matches title and description case-insensitively.
- Existing `cover-card-layout.test.ts` is unaffected (layout logic unchanged).
