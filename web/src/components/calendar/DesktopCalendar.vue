<script setup lang="ts">
import { CalendarDays, Grid3X3, List, Plus } from "@lucide/vue";
import {
	type CalendarType,
	createCalendar,
	createViewDay,
	createViewMonthAgenda,
	createViewMonthGrid,
	createViewWeek,
	viewMonthGrid,
} from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { createCurrentTimePlugin } from "@schedule-x/current-time";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { ScheduleXCalendar } from "@schedule-x/vue";
import "@schedule-x/theme-default/dist/index.css";
import { onMounted, ref, watch } from "vue";
import type { Calendar, Event, Tag } from "@/api/client";
import type { ComposerPrefill } from "@/composables/useComposer";
import DateGridEvent from "./DateGridEvent.vue";
import MonthAgendaEvent from "./MonthAgendaEvent.vue";
import MonthGridEvent from "./MonthGridEvent.vue";
import TimeGridEvent from "./TimeGridEvent.vue";

// The Schedule-X desktop grid. Lives in its own lazily-loaded component so the
// ~210 kB engine + theme only ship to desktop visitors — mobile uses the much
// lighter MobileCalendar. `events` arrives already filtered to the visible set.
const props = defineProps<{
	events: Event[];
	calendars: Calendar[];
	tags: Tag[];
	theme: "light" | "dark";
	connected: boolean;
	activeCalendarCount: number;
}>();

const emit = defineEmits<{
	open: [event: Event];
	create: [prefill?: ComposerPrefill];
}>();

type CalendarViewName = "month-grid" | "week" | "day" | "month-agenda";
const currentView = ref<CalendarViewName>("month-grid");
const viewOptions: Array<{
	name: CalendarViewName;
	label: string;
	icon: typeof Grid3X3;
}> = [
	{ name: "month-grid", label: "Month", icon: Grid3X3 },
	{ name: "week", label: "Week", icon: CalendarDays },
	{ name: "day", label: "Day", icon: CalendarDays },
	{ name: "month-agenda", label: "Agenda", icon: List },
];

const eventsService = createEventsServicePlugin();
const calendarControls = createCalendarControlsPlugin();
const currentTimePlugin = createCurrentTimePlugin({ fullWeekWidth: true });

// Rich event chips — Schedule-X drops its default background/text when a custom
// component is supplied, so these own the full appearance (see sx-event.ts).
const customComponents = {
	monthGridEvent: MonthGridEvent,
	timeGridEvent: TimeGridEvent,
	dateGridEvent: DateGridEvent,
	monthAgendaEvent: MonthAgendaEvent,
};

const calendarApp = createCalendar(
	{
		defaultView: viewMonthGrid.name,
		isResponsive: false,
		isDark: props.theme === "dark",
		monthGridOptions: { nEventsPerDay: 3 },
		weekOptions: {
			gridHeight: 980,
			nDays: 7,
			eventWidth: 96,
			eventOverlap: true,
			timeAxisFormatOptions: { hour: "2-digit" },
		},
		views: [
			createViewMonthGrid(),
			createViewWeek(),
			createViewDay(),
			createViewMonthAgenda(),
		],
		events: [],
		callbacks: {
			onEventClick(e) {
				const full = props.events.find((ev) => ev.id === String(e.id));
				if (full) emit("open", full);
			},
			onClickDateTime(dateTime) {
				emit("create", {
					start: dateTime.replace(" ", "T"),
					end: plusHour(dateTime),
					all_day: false,
				});
			},
			onClickDate(date) {
				emit("create", { start: date, end: date, all_day: true });
			},
		},
	},
	[eventsService, calendarControls, currentTimePlugin],
);

function toSx(iso: string, allDay: boolean): string {
	const d = new Date(iso);
	const p = (n: number) => String(n).padStart(2, "0");
	const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	return allDay ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function plusHour(dateTime: string): string {
	const d = new Date(dateTime.replace(" ", "T"));
	d.setHours(d.getHours() + 1);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function tagColor(name: string): string {
	return props.tags.find((t) => t.name === name)?.color ?? "#64748b";
}

function syncColors() {
	const map: Record<string, CalendarType> = {};
	for (const c of props.calendars) {
		const hex = c.color ?? "#3b82f6";
		map[c.id] = {
			colorName: c.id,
			label: c.name,
			lightColors: { main: hex, container: hex, onContainer: "#ffffff" },
		};
	}
	calendarControls.setCalendars(map);
}

function syncEvents() {
	eventsService.set(
		props.events.map((e) => ({
			id: e.id,
			title: e.title,
			calendarId: e.calendar_id,
			start: toSx(e.start_at, e.all_day),
			end: toSx(e.end_at, e.all_day),
			// Custom props — Schedule-X preserves these and hands them back to
			// the custom event components verbatim.
			description: e.description ?? undefined,
			location: e.location ?? undefined,
			_allDay: e.all_day,
			_calColor:
				props.calendars.find((c) => c.id === e.calendar_id)?.color ?? "#3b82f6",
			_tags: e.tags.map((name) => ({ name, color: tagColor(name) })),
		})),
	);
}

function setCalendarView(view: CalendarViewName) {
	currentView.value = view;
	calendarControls.setView(view);
}

onMounted(() => {
	syncColors();
	syncEvents();
});

// Keep Schedule-X in lockstep with the DaisyUI theme.
watch(
	() => props.theme,
	(t) => calendarApp.setTheme(t),
);
// Calendar colors feed both the calendar map and the chip accents.
watch(
	() => props.calendars,
	() => {
		syncColors();
		syncEvents();
	},
);
// Event data and tag colors feed the chips.
watch([() => props.events, () => props.tags], () => syncEvents());
</script>

<template>
	<div class="flex flex-wrap items-center gap-2 px-1">
		<div class="join">
			<button
				v-for="vw in viewOptions"
				:key="vw.name"
				type="button"
				class="btn btn-sm join-item gap-1 px-2"
				:class="currentView === vw.name ? 'btn-primary' : 'btn-ghost'"
				@click="setCalendarView(vw.name)"
			>
				<component :is="vw.icon" :size="15" aria-hidden="true" />
				<span>{{ vw.label }}</span>
			</button>
		</div>
		<div class="ml-auto flex items-center gap-2 text-xs text-base-content/60">
			<span class="badge badge-ghost">{{ activeCalendarCount }} calendars</span>
			<span class="badge badge-ghost">{{ props.events.length }} events</span>
			<span class="badge" :class="connected ? 'badge-success' : 'badge-error'">
				{{ connected ? "Live" : "Offline" }}
			</span>
		</div>
		<button class="btn btn-primary btn-sm gap-1 px-2" @click="emit('create')">
			<Plus :size="16" aria-hidden="true" />
			<span>New event</span>
		</button>
	</div>
	<div class="calendar-frame">
		<div class="calendar-scroll">
			<ScheduleXCalendar
				:calendar-app="calendarApp"
				:custom-components="customComponents"
			/>
		</div>
	</div>
</template>
