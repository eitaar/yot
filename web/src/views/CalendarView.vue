<script setup lang="ts">
import {
	createCalendar,
	createViewDay,
	createViewMonthGrid,
	createViewWeek,
} from "@schedule-x/calendar";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { ScheduleXCalendar } from "@schedule-x/vue";
import "@schedule-x/theme-default/dist/index.css";
import { onMounted } from "vue";
import type { Event } from "@/api/client";
import EventForm from "@/components/EventForm.vue";
import Sidebar from "@/components/Sidebar.vue";
import { useCalendars } from "@/composables/useCalendars";
import { useEvents } from "@/composables/useEvents";
import { useSSE } from "@/composables/useSSE";

const {
	calendars,
	load: loadCals,
	create: addCal,
	remove: delCal,
} = useCalendars();
const { events, load: loadEvents, create: addEvent } = useEvents();

const eventsService = createEventsServicePlugin();
const calendarApp = createCalendar({
	views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
	events: [],
	plugins: [eventsService],
});

function toSx(iso: string, allDay: boolean): string {
	const d = new Date(iso);
	const p = (n: number) => String(n).padStart(2, "0");
	const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	return allDay ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function syncCalendar(list: Event[]) {
	eventsService.set(
		list.map((e) => ({
			id: e.id,
			title: e.title,
			start: toSx(e.start_at, e.all_day),
			end: toSx(e.end_at, e.all_day),
		})),
	);
}

async function refresh() {
	await Promise.all([loadCals(), loadEvents()]);
	syncCalendar(events.value);
}

const { connected } = useSSE(refresh);
onMounted(refresh);
</script>

<template>
	<div class="flex gap-4">
		<Sidebar
			:calendars="calendars"
			:connected="connected"
			@add="(name) => addCal(name)"
			@remove="(id) => delCal(id)"
		/>
		<div class="min-w-0 flex-1 space-y-3">
			<EventForm :calendars="calendars" @submit="(input) => addEvent(input)" />
			<ScheduleXCalendar :calendar-app="calendarApp" />
		</div>
	</div>
</template>
