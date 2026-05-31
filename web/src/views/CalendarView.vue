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

const modalMode = ref<"create" | "view" | "edit" | null>(null);
const selected = ref<Event | null>(null);
const modalRef = ref<InstanceType<typeof EventModal> | null>(null);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const eventsService = createEventsServicePlugin();
const calendarApp = createCalendar({
	views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
	events: [],
	plugins: [eventsService],
	callbacks: {
		onEventClick(e) {
			const full = events.value.find((ev) => ev.id === String(e.id));
			if (full) {
				selected.value = full;
				modalMode.value = "view";
			}
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

function closeModal() {
	modalMode.value = null;
	selected.value = null;
}

function openCreate() {
	selected.value = null;
	modalMode.value = "create";
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
		<div class="flex min-w-0 flex-1 flex-col gap-3 p-4">
			<div class="flex items-center justify-end">
				<button class="btn btn-primary btn-sm" @click="openCreate">
					＋ New event
				</button>
			</div>
			<ScheduleXCalendar :calendar-app="calendarApp" />
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
		@close="closeModal"
		@create="onCreate"
		@save="onSave"
	/>
</template>
