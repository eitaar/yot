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
