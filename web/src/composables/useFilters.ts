import { ref } from "vue";
import type { Event } from "@/api/client";

// Module-level singleton state so filters are shared across views
// (CalendarView / ListView) and persist while navigating between them.
const enabledCalendarIds = ref<Set<string>>(new Set());
const knownCalendarIds = new Set<string>();
const selectedTag = ref<string | null>(null);

export function useFilters() {
	// Register the current set of calendars. New calendars default to enabled;
	// calendars that no longer exist are dropped. User toggles are preserved.
	function syncCalendars(ids: string[]) {
		const incoming = new Set(ids);
		for (const id of ids) {
			if (!knownCalendarIds.has(id)) {
				knownCalendarIds.add(id);
				enabledCalendarIds.value.add(id);
			}
		}
		for (const id of [...knownCalendarIds]) {
			if (!incoming.has(id)) {
				knownCalendarIds.delete(id);
				enabledCalendarIds.value.delete(id);
			}
		}
	}

	function toggleCalendar(id: string) {
		if (enabledCalendarIds.value.has(id)) {
			enabledCalendarIds.value.delete(id);
		} else {
			enabledCalendarIds.value.add(id);
		}
	}

	function setAllCalendars(enabled: boolean) {
		if (enabled) {
			for (const id of knownCalendarIds) enabledCalendarIds.value.add(id);
		} else {
			enabledCalendarIds.value.clear();
		}
	}

	function setTag(name: string | null) {
		selectedTag.value = name;
	}

	// Query params understood by the API (calendar filtering is client-side
	// because the API only supports a single calendar_id and we want multi-select).
	function buildQuery(): Record<string, string> {
		return selectedTag.value ? { tag: selectedTag.value } : {};
	}

	function applyCalendarFilter(events: Event[]): Event[] {
		return events.filter((e) => enabledCalendarIds.value.has(e.calendar_id));
	}

	return {
		enabledCalendarIds,
		selectedTag,
		syncCalendars,
		toggleCalendar,
		setAllCalendars,
		setTag,
		buildQuery,
		applyCalendarFilter,
	};
}
