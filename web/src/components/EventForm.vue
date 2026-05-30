<script setup lang="ts">
import { reactive } from "vue";
import type { Calendar } from "@/api/client";

const props = defineProps<{ calendars: Calendar[] }>();
const emit = defineEmits<{
	submit: [
		input: {
			calendar_id: string;
			title: string;
			start_at: string;
			end_at: string;
		},
	];
}>();

const form = reactive({ calendar_id: "", title: "", start: "", end: "" });

function submit() {
	if (!form.calendar_id || !form.title || !form.start || !form.end) return;
	emit("submit", {
		calendar_id: form.calendar_id,
		title: form.title,
		start_at: new Date(form.start).toISOString(),
		end_at: new Date(form.end).toISOString(),
	});
	form.title = "";
	form.start = "";
	form.end = "";
}
</script>

<template>
	<form class="flex flex-wrap gap-2" @submit.prevent="submit">
		<select v-model="form.calendar_id" required class="rounded border px-2 py-1">
			<option value="" disabled>Calendar</option>
			<option v-for="c in props.calendars" :key="c.id" :value="c.id">
				{{ c.name }}
			</option>
		</select>
		<input v-model="form.title" placeholder="Title" required class="rounded border px-2 py-1" />
		<input v-model="form.start" type="datetime-local" required class="rounded border px-2 py-1" />
		<input v-model="form.end" type="datetime-local" required class="rounded border px-2 py-1" />
		<button class="rounded bg-blue-600 px-3 py-1 text-white">Add</button>
	</form>
</template>
