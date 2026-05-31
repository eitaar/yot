<script setup lang="ts">
import { CalendarDays, MapPin, Plus, Search, Tags } from "@lucide/vue";
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

function eventDate(e: Event): string {
	return new Date(e.start_at).toLocaleDateString([], {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

function eventTime(e: Event): string {
	if (e.all_day) return "All day";
	const start = new Date(e.start_at);
	const end = new Date(e.end_at);
	const fmt: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
	return `${start.toLocaleTimeString([], fmt)} - ${end.toLocaleTimeString([], fmt)}`;
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
		<div class="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
			<div class="card border border-base-300 bg-base-100">
				<div class="card-body p-3 sm:p-4">
					<div class="flex flex-wrap items-center gap-2">
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
				</div>
			</div>
			<ul class="space-y-2">
				<li v-for="e in visibleEvents" :key="e.id">
					<button
						type="button"
						class="card w-full cursor-pointer border border-base-300 bg-base-100 text-left transition-colors hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
						@click="openView(e)"
					>
						<div class="card-body gap-2 p-3 sm:p-4">
							<div class="flex min-w-0 items-start gap-3">
								<span
									class="mt-1 inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
									:style="{ background: calendarColor(e.calendar_id) }"
								/>
								<div class="min-w-0 flex-1">
									<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
										<span class="truncate font-medium">{{ e.title }}</span>
										<span v-if="e.tags.length" class="badge badge-ghost badge-sm sm:hidden">
											<Tags :size="12" aria-hidden="true" />
											{{ e.tags.length }}
										</span>
									</div>
									<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/60 sm:text-sm">
										<span class="inline-flex items-center gap-1">
											<CalendarDays :size="14" aria-hidden="true" />
											{{ eventDate(e) }}
										</span>
										<span>{{ eventTime(e) }}</span>
									</div>
								</div>
							</div>
							<div v-if="e.tags.length" class="hidden flex-wrap gap-1 sm:flex">
								<span
									v-for="t in e.tags"
									:key="t"
									class="badge badge-sm border-0 text-white"
									:style="{ background: tagColor(t) }"
								>
									{{ t }}
								</span>
							</div>
							<p
								v-if="e.location"
								class="hidden items-center gap-1 text-xs text-base-content/50 sm:flex"
							>
								<MapPin :size="13" aria-hidden="true" />
								{{ e.location }}
							</p>
						</div>
					</button>
				</li>
				<li v-if="visibleEvents.length === 0" class="card border border-base-300 bg-base-100">
					<div class="card-body items-center py-8 text-sm text-base-content/50">
						No events.
					</div>
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
