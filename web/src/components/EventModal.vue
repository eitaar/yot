<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import type { Calendar, Event, EventUpdate, Tag } from "@/api/client";

const { event, calendars, tags } = defineProps<{
	event: Event;
	calendars: Calendar[];
	tags: Tag[];
}>();
const emit = defineEmits<{
	close: [];
	save: [id: string, updates: EventUpdate];
}>();

const mode = ref<"view" | "edit">("view");

const form = reactive({
	calendar_id: "",
	title: "",
	description: "",
	location: "",
	all_day: false,
	start: "",
	end: "",
});

const calendar = computed(() =>
	calendars.find((c) => c.id === event.calendar_id),
);

function tagColor(name: string): string {
	return tags.find((t) => t.name === name)?.color ?? "#666";
}

const dateRange = computed(() => {
	const e = event;
	if (e.all_day) {
		const sd = e.start_at.slice(0, 10);
		const ed = e.end_at.slice(0, 10);
		return sd === ed ? sd : `${sd} – ${ed}`;
	}
	const s = new Date(e.start_at);
	const en = new Date(e.end_at);
	const time = (d: Date) =>
		d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return `${s.toLocaleDateString()} ${time(s)} – ${time(en)}`;
});

const pad = (n: number) => String(n).padStart(2, "0");

function toDateInput(iso: string): string {
	return iso.slice(0, 10);
}

function toDateTimeInput(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function startEdit() {
	const e = event;
	form.calendar_id = e.calendar_id;
	form.title = e.title;
	form.description = e.description ?? "";
	form.location = e.location ?? "";
	form.all_day = e.all_day;
	form.start = e.all_day
		? toDateInput(e.start_at)
		: toDateTimeInput(e.start_at);
	form.end = e.all_day ? toDateInput(e.end_at) : toDateTimeInput(e.end_at);
	mode.value = "edit";
}

function onAllDayToggle() {
	if (form.all_day) {
		form.start = form.start.slice(0, 10);
		form.end = form.end.slice(0, 10);
	} else {
		if (form.start.length === 10) form.start += "T00:00";
		if (form.end.length === 10) form.end += "T00:00";
	}
}

function save() {
	if (!form.calendar_id || !form.title || !form.start || !form.end) return;
	const updates: EventUpdate = {
		calendar_id: form.calendar_id,
		title: form.title,
		description: form.description.trim() ? form.description : null,
		location: form.location.trim() ? form.location : null,
		all_day: form.all_day,
		start_at: new Date(form.start).toISOString(),
		end_at: new Date(form.end).toISOString(),
	};
	emit("save", event.id, updates);
}

function onKey(e: KeyboardEvent) {
	if (e.key === "Escape") emit("close");
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
		@click.self="emit('close')"
	>
		<div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
			<!-- View mode -->
			<div v-if="mode === 'view'" class="space-y-3">
				<div class="flex items-start justify-between gap-2">
					<h2 class="text-lg font-semibold">{{ event.title }}</h2>
					<button class="text-gray-400 hover:text-gray-600" @click="emit('close')">✕</button>
				</div>
				<div class="flex items-center gap-2 text-sm text-gray-600">
					<span
						class="inline-block h-3 w-3 rounded-full"
						:style="{ background: calendar?.color ?? '#999' }"
					/>
					<span>{{ calendar?.name ?? "Unknown calendar" }}</span>
				</div>
				<p class="text-sm text-gray-700">
					{{ dateRange }}
					<span v-if="event.all_day" class="ml-1 text-xs text-gray-400">(all day)</span>
				</p>
				<p v-if="event.location" class="text-sm text-gray-700">📍 {{ event.location }}</p>
				<p v-if="event.description" class="whitespace-pre-wrap text-sm text-gray-700">
					{{ event.description }}
				</p>
				<div v-if="event.tags.length" class="flex flex-wrap gap-1">
					<span
						v-for="t in event.tags"
						:key="t"
						class="rounded-full px-2 py-0.5 text-xs text-white"
						:style="{ background: tagColor(t) }"
					>
						{{ t }}
					</span>
				</div>
				<div class="flex justify-end gap-2 pt-2">
					<button
						class="rounded bg-blue-600 px-3 py-1 text-sm text-white"
						@click="startEdit"
					>
						Edit
					</button>
				</div>
			</div>

			<!-- Edit mode -->
			<form v-else class="space-y-3" @submit.prevent="save">
				<div class="flex items-center justify-between">
					<h2 class="text-lg font-semibold">Edit event</h2>
					<button type="button" class="text-gray-400 hover:text-gray-600" @click="emit('close')">
						✕
					</button>
				</div>
				<label class="block space-y-1">
					<span class="text-xs text-gray-500">Title</span>
					<input v-model="form.title" required class="w-full rounded border px-2 py-1" />
				</label>
				<label class="block space-y-1">
					<span class="text-xs text-gray-500">Calendar</span>
					<select v-model="form.calendar_id" required class="w-full rounded border px-2 py-1">
						<option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.name }}</option>
					</select>
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input v-model="form.all_day" type="checkbox" @change="onAllDayToggle" />
					All day
				</label>
				<div class="flex gap-2">
					<label class="block flex-1 space-y-1">
						<span class="text-xs text-gray-500">Start</span>
						<input
							v-model="form.start"
							:type="form.all_day ? 'date' : 'datetime-local'"
							required
							class="w-full rounded border px-2 py-1"
						/>
					</label>
					<label class="block flex-1 space-y-1">
						<span class="text-xs text-gray-500">End</span>
						<input
							v-model="form.end"
							:type="form.all_day ? 'date' : 'datetime-local'"
							required
							class="w-full rounded border px-2 py-1"
						/>
					</label>
				</div>
				<label class="block space-y-1">
					<span class="text-xs text-gray-500">Location</span>
					<input v-model="form.location" class="w-full rounded border px-2 py-1" />
				</label>
				<label class="block space-y-1">
					<span class="text-xs text-gray-500">Description</span>
					<textarea v-model="form.description" rows="3" class="w-full rounded border px-2 py-1" />
				</label>
				<div class="flex justify-end gap-2 pt-2">
					<button
						type="button"
						class="rounded border px-3 py-1 text-sm"
						@click="mode = 'view'"
					>
						Cancel
					</button>
					<button class="rounded bg-blue-600 px-3 py-1 text-sm text-white">Save</button>
				</div>
			</form>
		</div>
	</div>
</template>
