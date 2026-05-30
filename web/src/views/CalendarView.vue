<script setup lang="ts">
import {
	type CalendarType,
	createCalendar,
	createViewDay,
	createViewMonthGrid,
	createViewWeek,
} from "@schedule-x/calendar";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { ScheduleXCalendar } from "@schedule-x/vue";
import "@schedule-x/theme-default/dist/index.css";
import { onMounted, ref, watch } from "vue";
import type { Event } from "@/api/client";
import EventForm from "@/components/EventForm.vue";
import EventModal from "@/components/EventModal.vue";
import Sidebar from "@/components/Sidebar.vue";
import { useCalendars } from "@/composables/useCalendars";
import { useEvents } from "@/composables/useEvents";
import { useFilters } from "@/composables/useFilters";
import { useSSE } from "@/composables/useSSE";
import { useTags } from "@/composables/useTags";

const {
	calendars,
	load: loadCals,
	create: addCal,
	remove: delCal,
} = useCalendars();
const {
	events,
	load: loadEvents,
	create: addEvent,
	update: updateEvent,
} = useEvents();
const { tags, load: loadTags } = useTags();
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

const selected = ref<Event | null>(null);

const eventsService = createEventsServicePlugin();
const calendarApp = createCalendar({
	views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
	events: [],
	plugins: [eventsService],
	callbacks: {
		onEventClick(e) {
			const full = events.value.find((ev) => ev.id === String(e.id));
			if (full) selected.value = full;
		},
	},
});

function toSx(iso: string, allDay: boolean): string {
	const d = new Date(iso);
	const p = (n: number) => String(n).padStart(2, "0");
	const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	return allDay ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function syncColors() {
	const map: Record<string, CalendarType> = {};
	for (const c of calendars.value) {
		const hex = c.color ?? "#3b82f6";
		map[c.id] = {
			colorName: c.id,
			label: c.name,
			lightColors: { main: hex, container: hex, onContainer: "#ffffff" },
		};
	}
	// Schedule-X v2 exposes no public setCalendars; calendar definitions live on
	// an internal preact signal. Assigning it re-renders events in calendar colors.
	const internal = calendarApp as unknown as {
		$app: { config: { calendars: { value: Record<string, CalendarType> } } };
	};
	internal.$app.config.calendars.value = map;
}

function syncEvents() {
	const visible = applyCalendarFilter(events.value);
	eventsService.set(
		visible.map((e) => ({
			id: e.id,
			title: e.title,
			calendarId: e.calendar_id,
			start: toSx(e.start_at, e.all_day),
			end: toSx(e.end_at, e.all_day),
		})),
	);
}

async function refresh() {
	await Promise.all([loadCals(), loadTags(), loadEvents(buildQuery())]);
	syncCalendars(calendars.value.map((c) => c.id));
	syncColors();
	syncEvents();
}

// Tag filter is server-side → refetch; calendar filter is client-side → re-sync.
watch(selectedTag, async () => {
	await loadEvents(buildQuery());
	syncEvents();
});
watch(enabledCalendarIds, () => syncEvents(), { deep: true });

async function onSave(id: string, updates: Parameters<typeof updateEvent>[1]) {
	await updateEvent(id, updates);
	selected.value = null;
}

const { connected } = useSSE(refresh);
onMounted(refresh);
</script>

<template>
	<div class="flex gap-4">
		<Sidebar
			:calendars="calendars"
			:connected="connected"
			:tags="tags"
			:enabled-calendar-ids="enabledCalendarIds"
			:selected-tag="selectedTag"
			@add="(name) => addCal(name)"
			@remove="(id) => delCal(id)"
			@toggle-calendar="(id) => toggleCalendar(id)"
			@set-all="(enabled) => setAllCalendars(enabled)"
			@select-tag="(name) => setTag(name)"
		/>
		<div class="min-w-0 flex-1 space-y-3">
			<EventForm :calendars="calendars" @submit="(input) => addEvent(input)" />
			<ScheduleXCalendar :calendar-app="calendarApp" />
		</div>
	</div>
	<EventModal
		v-if="selected"
		:event="selected"
		:calendars="calendars"
		:tags="tags"
		@close="selected = null"
		@save="onSave"
	/>
</template>
