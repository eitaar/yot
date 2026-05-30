<script setup lang="ts">
import { onMounted, ref } from "vue";
import EventForm from "@/components/EventForm.vue";
import Sidebar from "@/components/Sidebar.vue";
import { useCalendars } from "@/composables/useCalendars";
import { useEvents } from "@/composables/useEvents";
import { useSSE } from "@/composables/useSSE";

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
	remove: delEvent,
} = useEvents();
const search = ref("");

async function refresh() {
	await Promise.all([
		loadCals(),
		loadEvents(search.value ? { q: search.value } : {}),
	]);
}

const { connected } = useSSE(refresh);
onMounted(refresh);
</script>

<template>
	<div class="flex gap-4">
		<Sidebar
			:calendars="calendars"
			:connected="connected"
			@add="(name) => addCal(name)"
			@remove="(id) => delCal(id)"
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
					v-for="e in events"
					:key="e.id"
					class="flex items-center justify-between px-3 py-2"
				>
					<span>
						<span class="font-medium">{{ e.title }}</span>
						<span class="ml-2 text-sm text-gray-500">
							{{ new Date(e.start_at).toLocaleString() }}
						</span>
					</span>
					<button class="text-sm text-red-600" @click="delEvent(e.id)">Delete</button>
				</li>
				<li v-if="events.length === 0" class="px-3 py-2 text-sm text-gray-400">
					No events.
				</li>
			</ul>
		</div>
	</div>
</template>
