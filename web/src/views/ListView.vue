<script setup lang="ts">
import { Plus, Search, SlidersHorizontal } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import type { Event, Tag } from "@/api/client";
import AgendaList from "@/components/AgendaList.vue";
import EventModal from "@/components/EventModal.vue";
import FilterSheet from "@/components/FilterSheet.vue";
import Sidebar from "@/components/Sidebar.vue";
import { useCalendars } from "@/composables/useCalendars";
import { useComposer } from "@/composables/useComposer";
import { useEvents } from "@/composables/useEvents";
import { useFilterSheet } from "@/composables/useFilterSheet";
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

const filterSheet = useFilterSheet();

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

async function onCreateTag(name: string, color?: string): Promise<Tag> {
	return await createTag(name, color);
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

const composer = useComposer();
watch(
	() => composer.tick.value,
	() => openCreate(),
);

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
			<div class="flex items-center gap-2">
				<button
					class="btn btn-ghost btn-sm gap-1 px-2 lg:hidden"
					aria-label="Filters"
					@click="filterSheet.open()"
				>
					<SlidersHorizontal :size="16" aria-hidden="true" />
				</button>
				<div class="join min-w-0 flex-1 sm:flex-none">
					<input
						v-model="search"
						placeholder="Search events"
						class="input input-sm join-item w-full sm:w-72"
						@keyup.enter="refresh"
					/>
					<button class="btn btn-neutral btn-sm join-item gap-1 px-2" @click="refresh">
						<Search :size="15" aria-hidden="true" />
						<span class="hidden sm:inline">Search</span>
					</button>
				</div>
				<button class="btn btn-primary btn-sm gap-1 px-2 sm:ml-auto" @click="openCreate">
					<Plus :size="16" aria-hidden="true" />
					<span class="hidden sm:inline">New event</span>
				</button>
			</div>
			<AgendaList
				:events="visibleEvents"
				:calendars="calendars"
				:tags="tags"
				@open="openView"
			/>
		</div>
	</div>
	<FilterSheet
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
	<EventModal
		v-if="modalMode"
		ref="modalRef"
		:key="`${modalMode}-${selected?.id ?? 'new'}`"
		:mode="modalMode"
		:event="selected"
		:calendars="calendars"
		:tags="tags"
		:create-tag="onCreateTag"
		@close="closeModal"
		@create="onCreate"
		@save="onSave"
	/>
</template>
