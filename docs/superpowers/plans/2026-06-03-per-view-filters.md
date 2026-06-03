# Per-view Filter Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Calendar, List, and Cover views independent filter settings (enabled calendars, selected tag, search) so changing a filter in one view does not affect the others.

**Architecture:** `useFilters` becomes scope-aware (`"calendar" | "list" | "cover"`), holding a separate `{enabledCalendarIds, selectedTag, search}` per scope at module level. All three filters are applied **client-side** via `applyFilters(events)` over one broadly-fetched shared event set (`useEvents`, `limit=500`). `ListView` (shared by `/list` and `/cover`) passes a *reactive* scope so it switches per-view state without remounting. This is a coordinated API change: the full app typechecks green only after Task 4 — the gate for Task 1 is its unit test.

**Tech Stack:** Vue 3 `<script setup>`, Vue reactivity (`ref`/`computed`), `node:test` + `tsx` for unit tests, `vue-tsc` for typecheck, Vite build.

**Spec:** `docs/superpowers/specs/2026-06-03-per-view-filters-design.md`

---

## File Structure

- `web/src/composables/useFilters.ts` — **rewrite.** Scope-aware filter state + client-side `applyFilters`. Single responsibility: hold and apply per-view filters.
- `web/test/use-filters.test.ts` — **create.** Unit tests for scope isolation, calendar sync defaults, and `applyFilters`.
- `web/src/composables/useEvents.ts` — **modify.** Default `load()` to fetch a broad window (`limit=500`).
- `web/src/views/CalendarView.vue` — **modify.** Use scope `"calendar"`, client-side filtering, drop server tag refetch.
- `web/src/views/ListView.vue` — **modify.** Reactive scope (`list`/`cover`), `search` from `useFilters`, client-side filtering, live search.

`Sidebar.vue` / `FilterSheet.vue` / `FiltersPanel.vue` are unchanged — they are stateless (props in, events out).

---

## Task 1: Scope-aware `useFilters` with client-side filtering

**Files:**
- Modify (rewrite): `web/src/composables/useFilters.ts`
- Test: `web/test/use-filters.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `web/test/use-filters.test.ts`:

```ts
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { ref } from "vue";
import type { Event } from "../src/api/client";
import {
	type FilterScope,
	resetFiltersForTest,
	useFilters,
} from "../src/composables/useFilters";

beforeEach(() => resetFiltersForTest());

function ev(overrides: Partial<Event> = {}): Event {
	return {
		id: "e",
		calendar_id: "c1",
		title: "Title",
		description: null,
		location: null,
		start_at: "2026-06-03T00:00:00.000Z",
		end_at: "2026-06-03T01:00:00.000Z",
		all_day: false,
		image_path: null,
		url: null,
		source_uid: null,
		created_at: "",
		updated_at: "",
		tags: [],
		reminders: [],
		...overrides,
	} as Event;
}

describe("useFilters scope isolation", () => {
	test("a scope opened after syncCalendars starts with all known enabled", () => {
		const list = useFilters("list");
		const cover = useFilters("cover");
		list.syncCalendars(["c1", "c2"]);
		assert.deepEqual([...list.enabledCalendarIds.value].sort(), ["c1", "c2"]);
		assert.deepEqual([...cover.enabledCalendarIds.value].sort(), ["c1", "c2"]);
	});

	test("toggling a calendar in one scope does not affect another", () => {
		const list = useFilters("list");
		const cover = useFilters("cover");
		list.syncCalendars(["c1", "c2"]);
		list.toggleCalendar("c1");
		assert.deepEqual([...list.enabledCalendarIds.value], ["c2"]);
		assert.deepEqual([...cover.enabledCalendarIds.value].sort(), ["c1", "c2"]);
	});

	test("tag and search are independent per scope", () => {
		const list = useFilters("list");
		const cover = useFilters("cover");
		list.setTag("work");
		list.search.value = "math";
		assert.equal(list.selectedTag.value, "work");
		assert.equal(list.search.value, "math");
		assert.equal(cover.selectedTag.value, null);
		assert.equal(cover.search.value, "");
	});

	test("syncCalendars adds to and removes from already-open scopes", () => {
		const cal = useFilters("calendar");
		void cal.enabledCalendarIds.value.size; // materialise the scope
		cal.syncCalendars(["c1", "c2"]);
		assert.deepEqual([...cal.enabledCalendarIds.value].sort(), ["c1", "c2"]);
		cal.syncCalendars(["c2"]);
		assert.deepEqual([...cal.enabledCalendarIds.value], ["c2"]);
	});

	test("a reactive scope ref flips to that scope's own state", () => {
		const scope = ref<FilterScope>("list");
		const f = useFilters(scope);
		f.setTag("a");
		assert.equal(f.selectedTag.value, "a");
		scope.value = "cover";
		assert.equal(f.selectedTag.value, null);
		f.setTag("b");
		scope.value = "list";
		assert.equal(f.selectedTag.value, "a");
	});
});

describe("applyFilters", () => {
	const events = [
		ev({ id: "1", calendar_id: "c1", title: "Algebra", tags: ["math"] }),
		ev({ id: "2", calendar_id: "c2", title: "History", tags: ["arts"] }),
		ev({
			id: "3",
			calendar_id: "c1",
			title: "Geometry",
			description: "shapes",
			tags: ["math"],
		}),
	];

	test("passes everything when all calendars enabled and no tag/search", () => {
		const f = useFilters("list");
		f.syncCalendars(["c1", "c2"]);
		assert.deepEqual(f.applyFilters(events).map((e) => e.id), ["1", "2", "3"]);
	});

	test("drops events whose calendar is disabled", () => {
		const f = useFilters("list");
		f.syncCalendars(["c1", "c2"]);
		f.toggleCalendar("c2");
		assert.deepEqual(f.applyFilters(events).map((e) => e.id), ["1", "3"]);
	});

	test("filters by tag name", () => {
		const f = useFilters("list");
		f.syncCalendars(["c1", "c2"]);
		f.setTag("arts");
		assert.deepEqual(f.applyFilters(events).map((e) => e.id), ["2"]);
	});

	test("search matches title and description, case-insensitively", () => {
		const f = useFilters("list");
		f.syncCalendars(["c1", "c2"]);
		f.search.value = "geo";
		assert.deepEqual(f.applyFilters(events).map((e) => e.id), ["3"]);
		f.search.value = "SHAPES";
		assert.deepEqual(f.applyFilters(events).map((e) => e.id), ["3"]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx tsx --test test/use-filters.test.ts`
Expected: FAIL — `resetFiltersForTest` is not exported (TypeError / undefined), `applyFilters`/`search` missing on the returned object.

- [ ] **Step 3: Rewrite `useFilters`**

Replace the entire contents of `web/src/composables/useFilters.ts` with:

```ts
import { computed, isRef, type Ref, ref } from "vue";
import type { Event } from "@/api/client";

// Filter state is namespaced per view ("scope") so the Calendar, List, and Cover
// faces filter independently. State lives at module scope so it persists while
// navigating between views, and ALL filtering is client-side: a single shared
// event set (see useEvents) is fetched once and each view derives its own visible
// slice. (The calendar-checkbox filter was already client-side; tag and search
// used to round-trip to the server, which forced every view to share one result.)
export type FilterScope = "calendar" | "list" | "cover";

type ScopeState = {
	enabledCalendarIds: Ref<Set<string>>;
	selectedTag: Ref<string | null>;
	search: Ref<string>;
};

const scopes = new Map<FilterScope, ScopeState>();
const knownCalendarIds = new Set<string>();

// A scope is materialised on first use, starting with every currently-known
// calendar enabled (so a view opened later still shows everything by default),
// no tag, and no search.
function stateFor(scope: FilterScope): ScopeState {
	let state = scopes.get(scope);
	if (!state) {
		state = {
			enabledCalendarIds: ref(new Set(knownCalendarIds)),
			selectedTag: ref<string | null>(null),
			search: ref(""),
		};
		scopes.set(scope, state);
	}
	return state;
}

/** Test-only: drop all per-scope state and the calendar registry. */
export function resetFiltersForTest(): void {
	scopes.clear();
	knownCalendarIds.clear();
}

export function useFilters(scope: FilterScope | Ref<FilterScope>) {
	// CalendarView passes a literal; ListView passes a ref that flips between
	// "list" and "cover" as the route changes (no remount), so the bound state
	// must track the current scope.
	const scopeRef: Ref<FilterScope> = isRef(scope) ? scope : ref(scope);

	const enabledCalendarIds = computed(
		() => stateFor(scopeRef.value).enabledCalendarIds.value,
	);
	const selectedTag = computed(
		() => stateFor(scopeRef.value).selectedTag.value,
	);
	const search = computed({
		get: () => stateFor(scopeRef.value).search.value,
		set: (value: string) => {
			stateFor(scopeRef.value).search.value = value;
		},
	});

	// New calendars default to enabled in EVERY scope; calendars that no longer
	// exist are dropped from every scope. Per-scope user toggles are preserved.
	function syncCalendars(ids: string[]) {
		const incoming = new Set(ids);
		for (const id of ids) {
			if (!knownCalendarIds.has(id)) {
				knownCalendarIds.add(id);
				for (const state of scopes.values())
					state.enabledCalendarIds.value.add(id);
			}
		}
		for (const id of [...knownCalendarIds]) {
			if (!incoming.has(id)) {
				knownCalendarIds.delete(id);
				for (const state of scopes.values())
					state.enabledCalendarIds.value.delete(id);
			}
		}
	}

	function toggleCalendar(id: string) {
		const set = stateFor(scopeRef.value).enabledCalendarIds.value;
		if (set.has(id)) set.delete(id);
		else set.add(id);
	}

	function setAllCalendars(enabled: boolean) {
		const set = stateFor(scopeRef.value).enabledCalendarIds.value;
		if (enabled) for (const id of knownCalendarIds) set.add(id);
		else set.clear();
	}

	function setTag(name: string | null) {
		stateFor(scopeRef.value).selectedTag.value = name;
	}

	// Mirrors the server's calendar/tag/q semantics, client-side.
	function applyFilters(events: Event[]): Event[] {
		const state = stateFor(scopeRef.value);
		const enabled = state.enabledCalendarIds.value;
		const tag = state.selectedTag.value;
		const q = state.search.value.trim().toLowerCase();
		return events.filter((e) => {
			if (!enabled.has(e.calendar_id)) return false;
			if (tag && !e.tags.includes(tag)) return false;
			if (q) {
				const haystack = `${e.title} ${e.description ?? ""}`.toLowerCase();
				if (!haystack.includes(q)) return false;
			}
			return true;
		});
	}

	return {
		enabledCalendarIds,
		selectedTag,
		search,
		syncCalendars,
		toggleCalendar,
		setAllCalendars,
		setTag,
		applyFilters,
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx tsx --test test/use-filters.test.ts`
Expected: PASS — all tests green (`pass 9`, `fail 0` across the two describe blocks).

- [ ] **Step 5: Commit**

```bash
git add web/src/composables/useFilters.ts web/test/use-filters.test.ts
git commit -m "$(cat <<'EOF'
feat(filters): make useFilters scope-aware with client-side filtering

Namespaces enabled-calendars/tag/search per view ("calendar"/"list"/
"cover") and applies all three client-side via applyFilters(). Replaces
the shared singleton + server-side tag/q filtering. Views wired next.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Broaden the shared event fetch

**Files:**
- Modify: `web/src/composables/useEvents.ts:8-10`

- [ ] **Step 1: Change the default query**

In `web/src/composables/useEvents.ts`, replace:

```ts
	async function load(query: Record<string, string> = {}) {
		events.value = await api.listEvents(query);
	}
```

with:

```ts
	// One broad fetch feeds every view; filtering is client-side (see useFilters).
	// 500 is the server's max page size — enough headroom for the client filters.
	async function load(query: Record<string, string> = { limit: "500" }) {
		events.value = await api.listEvents(query);
	}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/composables/useEvents.ts
git commit -m "$(cat <<'EOF'
feat(events): fetch a broad window (limit=500) for client-side filtering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire CalendarView to the `"calendar"` scope

**Files:**
- Modify: `web/src/views/CalendarView.vue`

- [ ] **Step 1: Use the calendar scope and drop server-side tag filtering**

Edit A — destructure (replace the `useFilters()` block, ~lines 47-56):

```ts
	const {
		enabledCalendarIds,
		selectedTag,
		syncCalendars,
		toggleCalendar,
		setAllCalendars,
		setTag,
		buildQuery,
		applyCalendarFilter,
	} = useFilters();
```

→

```ts
	const {
		enabledCalendarIds,
		selectedTag,
		syncCalendars,
		toggleCalendar,
		setAllCalendars,
		setTag,
		applyFilters,
	} = useFilters("calendar");
```

Edit B — visible events (~line 76):

```ts
	const visibleEvents = computed(() => applyCalendarFilter(events.value));
```

→

```ts
	const visibleEvents = computed(() => applyFilters(events.value));
```

Edit C — event refresh job (~line 91):

```ts
		if (want.has("event")) jobs.push(loadEvents(buildQuery()));
```

→

```ts
		if (want.has("event")) jobs.push(loadEvents());
```

Edit D — remove the now-obsolete tag watch (~lines 107-108). Delete:

```ts
	// Tag filter is server-side → refetch events.
	watch(selectedTag, () => refresh("event"));
```

- [ ] **Step 2: Sanity-check the file**

Confirm `selectedTag` is still used (it is — passed as `:selected-tag` to `Sidebar` and `FilterSheet`) and `watch` is still imported/used (it is — the `composer.tick` watch). No import changes needed.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/CalendarView.vue
git commit -m "$(cat <<'EOF'
feat(calendar): use the per-view "calendar" filter scope (client-side)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire ListView to a reactive `list`/`cover` scope with live search

**Files:**
- Modify: `web/src/views/ListView.vue`

- [ ] **Step 1: Import the scope type**

Replace (~line 15):

```ts
import { useFilters } from "@/composables/useFilters";
```

→

```ts
import { type FilterScope, useFilters } from "@/composables/useFilters";
```

- [ ] **Step 2: Reactive scope + filter state (replace the destructure + local search)**

Replace this block (~lines 41-57):

```ts
	const {
		enabledCalendarIds,
		selectedTag,
		syncCalendars,
		toggleCalendar,
		setAllCalendars,
		setTag,
		buildQuery,
		applyCalendarFilter,
	} = useFilters();

	const filterSheet = useFilterSheet();

	const route = useRoute();
	const coverMode = computed(() => route.name === "cover");

	const search = ref("");
```

→

```ts
	const filterSheet = useFilterSheet();

	const route = useRoute();
	const coverMode = computed(() => route.name === "cover");
	// List and Cover share this component instance; the scope flips with the route
	// so each keeps its own calendar/tag/search selection without a remount.
	const scope = computed<FilterScope>(() => (coverMode.value ? "cover" : "list"));

	const {
		enabledCalendarIds,
		selectedTag,
		search,
		syncCalendars,
		toggleCalendar,
		setAllCalendars,
		setTag,
		applyFilters,
	} = useFilters(scope);
```

- [ ] **Step 3: Remove the server-side `query()` and use the broad fetch**

Delete this function (~lines 64-68):

```ts
	function query(): Record<string, string> {
		const q = buildQuery();
		if (search.value) q.q = search.value;
		return q;
	}
```

And replace the event refresh job (~line 80):

```ts
		if (want.has("event")) jobs.push(loadEvents(query()));
```

→

```ts
		if (want.has("event")) jobs.push(loadEvents());
```

- [ ] **Step 4: Make search client-side/live and drop the tag refetch watch**

Replace this block (~lines 96-103):

```ts
	// Search and tag filter both reshape the server-side event query.
	function runSearch(): Promise<void> {
		return refresh("event");
	}

	const visibleEvents = computed(() => applyCalendarFilter(events.value));

	watch(selectedTag, () => refresh("event"));
```

→

```ts
	// Search now filters client-side (live, via v-model on `search`). Enter / the
	// Search button just drop focus — handy for dismissing the mobile keyboard.
	function runSearch(): void {
		(document.activeElement as HTMLElement | null)?.blur();
	}

	const visibleEvents = computed(() => applyFilters(events.value));
```

- [ ] **Step 5: Sanity-check the file**

The template is unchanged: `v-model="search"` now binds the writable computed from `useFilters`; `@keyup.enter="runSearch"` and the Search button's `@click="runSearch"` still resolve. Confirm `ref` is still imported/used (`modalMode`, `selected`, `modalRef`) and `watch` is still used (`composer.tick`). No other references to `query`, `buildQuery`, or `applyCalendarFilter` remain.

- [ ] **Step 6: Typecheck the whole app (now coherent)**

Run: `cd web && npx vue-tsc --noEmit`
Expected: no errors. (Tasks 1–4 form one API change; this is the first point the app typechecks green.)

- [ ] **Step 7: Commit**

```bash
git add web/src/views/ListView.vue
git commit -m "$(cat <<'EOF'
feat(list): independent list/cover filter scopes with live client-side search

ListView passes a reactive scope (list vs cover) to useFilters and binds
search to the per-scope writable computed; filtering and search are now
client-side, so List and Cover no longer share filter settings.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the new and existing web unit tests**

Run: `cd web && npx tsx --test test/use-filters.test.ts test/cover-card-layout.test.ts`
Expected: all PASS (`fail 0`). `cover-card-layout` is unaffected by these changes.

- [ ] **Step 2: Typecheck + build**

Run: `cd web && npm run build`
Expected: `vue-tsc --noEmit` passes and `vite build` completes without errors.

- [ ] **Step 3: Format check**

Run (from repo root): `npm run format`
Expected: Biome reports no remaining issues (it auto-fixes). Review any reformatting and include it in a follow-up commit if files changed.

- [ ] **Step 4: Manual smoke test**

Run the app (`npm run web:dev`, or use the `run` skill) and verify per-view independence:
- In **Cover**, uncheck a calendar → its events disappear from Cover; switch to **Calendar** → those events still show. ✅ independent calendars
- In **List**, select a tag → only tagged events show in List; switch to **Cover** → no tag applied. ✅ independent tag
- In **List**, type in Search → results filter live as you type; switch to **Cover** → search box is empty and all events show. ✅ independent, live search
- Switching List ↔ Cover does **not** trigger a network refetch (Network tab quiet) and is instant. ✅ no remount/refetch

- [ ] **Step 5: Commit any formatting changes (only if Step 3 changed files)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
style: biome formatting for per-view filters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Per-view independence (calendar/tag/search) → Tasks 1, 3, 4. ✅
- Scope-aware `useFilters` + lazy init + `syncCalendars` defaults → Task 1. ✅
- Reactive scope for List/Cover (no remount) → Task 1 (`Ref<FilterScope>` support) + Task 4. ✅
- Client-side `applyFilters` mirroring calendar/tag/q → Task 1. ✅
- Broad fetch `limit=500` → Task 2. ✅
- Live client-side search; Search button/Enter remain as affordances → Task 4. ✅
- Stateless Sidebar/FilterSheet/FiltersPanel untouched → noted in File Structure. ✅
- Out of scope (persistence, 500 ceiling) → not implemented, per spec. ✅
- Testing (scope isolation, sync defaults, applyFilters) → Task 1 test file. ✅

**Placeholder scan:** none — all steps contain concrete code/commands.

**Type/name consistency:** `FilterScope`, `useFilters`, `resetFiltersForTest`, `applyFilters`, `search`, `enabledCalendarIds`, `selectedTag`, `syncCalendars`, `toggleCalendar`, `setAllCalendars`, `setTag` are used identically across Task 1 (definition), the test, and Tasks 3–4 (consumers). `buildQuery`/`applyCalendarFilter`/`query()` are removed everywhere they appeared.
