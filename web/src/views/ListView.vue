<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
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

const search = ref("");
const modalMode = ref<"create" | "view" | "edit" | null>(null);
const selected = ref<Event | null>(null);
const modalRef = ref<InstanceType<typeof EventModal> | null>(null);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
	return calendars.value.find((c) => c.id === id)?.color ?? "#94a3b8";
}
function tagColor(name: string): string {
	return tags.value.find((t) => t.name === name)?.color ?? "#64748b";
}

// Tag filter is server-side → refetch (calendar filter is client-side via computed).
watch(selectedTag, refresh);

function closeModal() {
	modalMode.value = null;
	selected.value = null;
}
function openCreate() {
	selected.value = null;
	modalMode.value = "create";
}
function openView(e: Event) {
	selected.value = e;
	modalMode.value = "view";
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
			<div class="flex items-center gap-2">
				<input
					v-model="search"
					placeholder="Search events…"
					class="w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-accent focus:ring-1 focus:ring-accent dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
					@keyup.enter="refresh"
				/>
				<button
					class="rounded-md bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
					@click="refresh"
				>
					Search
				</button>
				<button
					class="ml-auto rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
					@click="openCreate"
				>
					＋ New event
				</button>
			</div>
			<ul
				class="divide-y divide-slate-100 overflow-hidden rounded-card border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
			>
				<li
					v-for="e in visibleEvents"
					:key="e.id"
					class="cursor-pointer px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800"
					@click="openView(e)"
				>
					<div class="flex items-center gap-2">
						<span
							class="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
							:style="{ background: calendarColor(e.calendar_id) }"
						/>
						<span class="font-medium text-slate-900 dark:text-slate-100">{{
							e.title
						}}</span>
						<span class="text-sm text-slate-500 dark:text-slate-400">
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
					</div>
					<p
						v-if="e.location"
						class="ml-5 mt-0.5 text-xs text-slate-400 dark:text-slate-500"
					>
						📍 {{ e.location }}
					</p>
				</li>
				<li
					v-if="visibleEvents.length === 0"
					class="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500"
				>
					No events.
				</li>
			</ul>
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
