<script setup lang="ts">
import { SlidersHorizontal } from "@lucide/vue";
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
import type { Event, Tag } from "@/api/client";
import EventModal from "@/components/EventModal.vue";
import FilterSheet from "@/components/FilterSheet.vue";
import MobileCalendar from "@/components/MobileCalendar.vue";
import Sidebar from "@/components/Sidebar.vue";
import { useCalendars } from "@/composables/useCalendars";
import { type ComposerPrefill, useComposer } from "@/composables/useComposer";
import { useEvents } from "@/composables/useEvents";
import { useFilterSheet } from "@/composables/useFilterSheet";
import { useFilters } from "@/composables/useFilters";
import { useIsDesktop } from "@/composables/useMediaQuery";
import { coalesce } from "@/composables/useRefresh";
import { type ChangeResource, useSSE } from "@/composables/useSSE";
import { useTags } from "@/composables/useTags";
import { useTheme } from "@/composables/useTheme";

// Lazily loaded so the ~210 kB Schedule-X engine + theme ship only to desktop
// visitors; mobile uses the much lighter MobileCalendar.
const DesktopCalendar = defineAsyncComponent(
	() => import("@/components/calendar/DesktopCalendar.vue"),
);

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
	applyFilters,
} = useFilters("calendar");

const isDesktop = useIsDesktop();
const { resolvedTheme } = useTheme();
const composer = useComposer();
const filterSheet = useFilterSheet();

async function onCreateTag(name: string, color?: string): Promise<Tag> {
	return await createTag(name, color);
}

const modalMode = ref<"create" | "view" | "edit" | null>(null);
const selected = ref<Event | null>(null);
const createPrefill = ref<ComposerPrefill | null>(null);
const modalRef = ref<InstanceType<typeof EventModal> | null>(null);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Calendar filtering is client-side (DesktopCalendar/MobileCalendar both render
// this already-filtered set), so toggling calendars needs no refetch.
const visibleEvents = computed(() => applyFilters(events.value));
const activeCalendarCount = computed(() => enabledCalendarIds.value.size);

// Reload only the resources that actually changed, coalescing the bursts that
// come from a mutation's own refresh racing the SSE broadcast it triggers.
// An event change reloads just the events (1 request) instead of also pulling
// calendars and tags.
const dirty = new Set<ChangeResource>();

async function runRefresh() {
	const want = new Set(dirty);
	dirty.clear();
	const jobs: Promise<unknown>[] = [];
	if (want.has("calendar")) jobs.push(loadCals());
	if (want.has("tag")) jobs.push(loadTags());
	if (want.has("event")) jobs.push(loadEvents());
	await Promise.all(jobs);
	if (want.has("calendar")) syncCalendars(calendars.value.map((c) => c.id));
}

const flush = coalesce(runRefresh);

function refresh(...resources: ChangeResource[]): Promise<void> {
	for (const r of resources) dirty.add(r);
	return flush();
}

function refreshAll(): Promise<void> {
	return refresh("calendar", "tag", "event");
}


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
		await refresh("event");
		modalRef.value?.requestClose();
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
		await refresh("event");
		modalRef.value?.requestClose();
	} catch (e) {
		modalRef.value?.setError(msg(e));
	}
}

function openView(e: Event) {
	selected.value = e;
	modalMode.value = "view";
}

const { connected } = useSSE((resource) => refresh(resource));
onMounted(refreshAll);
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
			<!-- Desktop: full Schedule-X grid + controls (lazily loaded) -->
			<DesktopCalendar
				v-if="isDesktop"
				:events="visibleEvents"
				:calendars="calendars"
				:tags="tags"
				:theme="resolvedTheme"
				:connected="connected"
				:active-calendar-count="activeCalendarCount"
				@open="openView"
				@create="(p) => openCreate(p ?? null)"
			/>

			<!-- Mobile: month/week grid -->
			<template v-else>
				<div class="flex items-center px-1">
					<button
						class="btn btn-ghost btn-sm gap-1 px-2"
						aria-label="Filters"
						@click="filterSheet.open()"
					>
						<SlidersHorizontal :size="16" aria-hidden="true" />
						<span>Filters</span>
					</button>
				</div>
				<MobileCalendar
					:events="visibleEvents"
					:calendars="calendars"
					:tags="tags"
					@open="openView"
					@create="(p) => openCreate(p)"
				/>
			</template>
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
		:prefill="createPrefill"
		@close="closeModal"
		@create="onCreate"
		@save="onSave"
	/>
</template>
