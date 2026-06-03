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
		assert.deepEqual(
			f.applyFilters(events).map((e) => e.id),
			["1", "2", "3"],
		);
	});

	test("drops events whose calendar is disabled", () => {
		const f = useFilters("list");
		f.syncCalendars(["c1", "c2"]);
		f.toggleCalendar("c2");
		assert.deepEqual(
			f.applyFilters(events).map((e) => e.id),
			["1", "3"],
		);
	});

	test("filters by tag name", () => {
		const f = useFilters("list");
		f.syncCalendars(["c1", "c2"]);
		f.setTag("arts");
		assert.deepEqual(
			f.applyFilters(events).map((e) => e.id),
			["2"],
		);
	});

	test("search matches title and description, case-insensitively", () => {
		const f = useFilters("list");
		f.syncCalendars(["c1", "c2"]);
		f.search.value = "geo";
		assert.deepEqual(
			f.applyFilters(events).map((e) => e.id),
			["3"],
		);
		f.search.value = "SHAPES";
		assert.deepEqual(
			f.applyFilters(events).map((e) => e.id),
			["3"],
		);
	});
});
