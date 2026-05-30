<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
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
	remove: delEvent,
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

const search = ref("");
const selected = ref<Event | null>(null);

function query(): Record<string, string> {
	const q = buildQuery();
	if (search.value) q.q = search.value;
	return q;
}

async function refresh() {
	await Promise.all([loadCals(), loadTags(), loadEvents(query())]);
	syncCalendars(calendars.value.map((c) => c.id));
}

const visibleEvents = computed(() => applyCalendarFilter(events.value));

function calendarColor(id: string): string {
	return calendars.value.find((c) => c.id === id)?.color ?? "#999";
}
function tagColor(name: string): string {
	return tags.value.find((t) => t.name === name)?.color ?? "#666";
}

// Tag filter is server-side → refetch (calendar filter is client-side via computed).
watch(selectedTag, refresh);

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
			<div class="flex gap-2">
				<input
					v-model="search"
					placeholder="Search..."
					class="rounded border px-2 py-1"
					@keyup.enter="refresh"
				/>
				<button class="rounded bg-gray-200 px-3 py-1" @click="refresh">Search</button>
			</div>
			<EventForm :calendars="calendars" @submit="(input) => addEvent(input)" />
			<ul class="divide-y rounded border bg-white">
				<li
					v-for="e in visibleEvents"
					:key="e.id"
					class="flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-gray-50"
					@click="selected = e"
				>
					<span class="min-w-0">
						<span class="flex items-center gap-2">
							<span
								class="inline-block h-3 w-3 shrink-0 rounded-full"
								:style="{ background: calendarColor(e.calendar_id) }"
							/>
							<span class="font-medium">{{ e.title }}</span>
							<span class="text-sm text-gray-500">
								{{ new Date(e.start_at).toLocaleString() }}
							</span>
							<span
								v-for="t in e.tags"
								:key="t"
								class="rounded-full px-2 py-0.5 text-xs text-white"
								:style="{ background: tagColor(t) }"
							>
								{{ t }}
							</span>
						</span>
						<span v-if="e.location" class="ml-5 block text-xs text-gray-400">
							📍 {{ e.location }}
						</span>
					</span>
					<button class="shrink-0 text-sm text-red-600" @click.stop="delEvent(e.id)">
						Delete
					</button>
				</li>
				<li v-if="visibleEvents.length === 0" class="px-3 py-2 text-sm text-gray-400">
					No events.
				</li>
			</ul>
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
