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
import { computed, onMounted, ref, watch } from "vue";
import type { Event } from "@/api/client";
import AgendaList from "@/components/AgendaList.vue";
import DateGridEvent from "@/components/calendar/DateGridEvent.vue";
import MonthAgendaEvent from "@/components/calendar/MonthAgendaEvent.vue";
import MonthGridEvent from "@/components/calendar/MonthGridEvent.vue";
import TimeGridEvent from "@/components/calendar/TimeGridEvent.vue";
import EventModal from "@/components/EventModal.vue";
import Sidebar from "@/components/Sidebar.vue";
import { useCalendars } from "@/composables/useCalendars";
import { type ComposerPrefill, useComposer } from "@/composables/useComposer";
import { useEvents } from "@/composables/useEvents";
import { useFilters } from "@/composables/useFilters";
import { useIsDesktop } from "@/composables/useMediaQuery";
import { useSSE } from "@/composables/useSSE";
import { useTags } from "@/composables/useTags";
import { useTheme } from "@/composables/useTheme";

const {
	calendars,
	load: loadCals,
	create: addCal,
	update: updateCal,
} = useCalendars();
const {
	events,
	load: loadEvents,
	create: addEvent,
	update: updateEvent,
	addTag: addEventTag,
	removeTag: removeEventTag,
} = useEvents();
const {
	tags,
	load: loadTags,
	create: createTag,
	update: updateTag,
	remove: removeTag,
} = useTags();
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

const isDesktop = useIsDesktop();
const { resolvedTheme } = useTheme();
const composer = useComposer();

const modalMode = ref<"create" | "view" | "edit" | null>(null);
const selected = ref<Event | null>(null);
const createPrefill = ref<ComposerPrefill | null>(null);
const modalRef = ref<InstanceType<typeof EventModal> | null>(null);
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

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
		isDark: resolvedTheme.value === "dark",
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
				const full = events.value.find((ev) => ev.id === String(e.id));
				if (full) {
					selected.value = full;
					modalMode.value = "view";
				}
			},
			onClickDateTime(dateTime) {
				openCreate({
					start: dateTime.replace(" ", "T"),
					end: plusHour(dateTime),
					all_day: false,
				});
			},
			onClickDate(date) {
				openCreate({ start: date, end: date, all_day: true });
			},
		},
	},
	[eventsService, calendarControls, currentTimePlugin],
);

// Keep Schedule-X in lockstep with the DaisyUI theme (fixes calendar text that
// otherwise stays dark when switching themes).
watch(resolvedTheme, (t) => calendarApp.setTheme(t));

const visibleEvents = computed(() => applyCalendarFilter(events.value));
const visibleEventsCount = computed(() => visibleEvents.value.length);
const activeCalendarCount = computed(() => enabledCalendarIds.value.size);

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
	return tags.value.find((t) => t.name === name)?.color ?? "#64748b";
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
	calendarControls.setCalendars(map);
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
			// Custom props — Schedule-X preserves these and hands them back to
			// the custom event components verbatim.
			description: e.description ?? undefined,
			location: e.location ?? undefined,
			_allDay: e.all_day,
			_calColor:
				calendars.value.find((c) => c.id === e.calendar_id)?.color ?? "#3b82f6",
			_tags: e.tags.map((name) => ({ name, color: tagColor(name) })),
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

// The bottom dock's "+ New" lives outside this view; it bumps the composer.
watch(
	() => composer.tick.value,
	() => openCreate(composer.prefill.value),
);

function closeModal() {
	modalMode.value = null;
	selected.value = null;
	createPrefill.value = null;
}

function openCreate(prefill: ComposerPrefill | null = null) {
	selected.value = null;
	createPrefill.value = prefill;
	modalMode.value = "create";
}

function setCalendarView(view: CalendarViewName) {
	currentView.value = view;
	calendarControls.setView(view);
}

function tagIdsOf(names: string[]): Set<string> {
	return new Set(
		names
			.map((n) => tags.value.find((t) => t.name === n)?.id)
			.filter((id): id is string => !!id),
	);
}

async function onCreate(
	input: Parameters<typeof addEvent>[0],
	tagIds: string[],
) {
	try {
		const created = await addEvent(input);
		for (const tagId of tagIds) await addEventTag(created.id, tagId);
		await refresh();
		closeModal();
	} catch (e) {
		modalRef.value?.setError(msg(e));
	}
}

async function onSave(
	id: string,
	updates: Parameters<typeof updateEvent>[1],
	tagIds: string[],
) {
	try {
		await updateEvent(id, updates);
		const current = tagIdsOf(selected.value?.tags ?? []);
		const desired = new Set(tagIds);
		for (const tagId of desired) {
			if (!current.has(tagId)) await addEventTag(id, tagId);
		}
		for (const tagId of current) {
			if (!desired.has(tagId)) await removeEventTag(id, tagId);
		}
		await refresh();
		closeModal();
	} catch (e) {
		modalRef.value?.setError(msg(e));
	}
}

function openView(e: Event) {
	selected.value = e;
	modalMode.value = "view";
}

const { connected } = useSSE(refresh);
onMounted(refresh);
</script>

<template>
	<div class="flex w-full">
		<Sidebar
			:calendars="calendars"
			:connected="connected"
			:tags="tags"
			:enabled-calendar-ids="enabledCalendarIds"
			:selected-tag="selectedTag"
			@toggle-calendar="(id) => toggleCalendar(id)"
			@set-all="(enabled) => setAllCalendars(enabled)"
			@select-tag="(name) => setTag(name)"
			@add-calendar="(name) => addCal(name)"
			@rename-calendar="(id, name) => updateCal(id, { name })"
			@recolor-calendar="(id, color) => updateCal(id, { color })"
			@add-tag="(name, color) => createTag(name, color ?? undefined)"
			@rename-tag="(id, name) => updateTag(id, { name })"
			@recolor-tag="(id, color) => updateTag(id, { color })"
			@delete-tag="(id) => removeTag(id)"
		/>
		<div class="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
			<!-- Desktop: full Schedule-X grid + controls -->
			<template v-if="isDesktop">
				<div class="card border border-base-300 bg-base-100">
					<div class="card-body gap-3 p-3 sm:p-4">
						<div class="flex flex-wrap items-center gap-2">
							<div class="join">
								<button
									v-for="view in viewOptions"
									:key="view.name"
									type="button"
									class="btn btn-sm join-item gap-1 px-2"
									:class="currentView === view.name ? 'btn-primary' : 'btn-ghost'"
									@click="setCalendarView(view.name)"
								>
									<component :is="view.icon" :size="15" aria-hidden="true" />
									<span>{{ view.label }}</span>
								</button>
							</div>
							<div class="ml-auto flex items-center gap-2 text-xs text-base-content/60">
								<span class="badge badge-ghost">{{ activeCalendarCount }} calendars</span>
								<span class="badge badge-ghost">{{ visibleEventsCount }} events</span>
								<span
									class="badge"
									:class="connected ? 'badge-success' : 'badge-error'"
								>
									{{ connected ? "Live" : "Offline" }}
								</span>
							</div>
							<button class="btn btn-primary btn-sm gap-1 px-2" @click="openCreate()">
								<Plus :size="16" aria-hidden="true" />
								<span>New event</span>
							</button>
						</div>
					</div>
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

			<!-- Mobile: dedicated agenda day-list -->
			<AgendaList
				v-else
				:events="visibleEvents"
				:calendars="calendars"
				:tags="tags"
				@open="openView"
			/>
		</div>
	</div>
	<EventModal
		v-if="modalMode"
		ref="modalRef"
		:key="`${modalMode}-${selected?.id ?? 'new'}`"
		:mode="modalMode"
		:event="selected"
		:calendars="calendars"
		:tags="tags"
		:prefill="createPrefill"
		@close="closeModal"
		@create="onCreate"
		@save="onSave"
	/>
</template>
