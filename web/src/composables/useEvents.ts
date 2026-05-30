import { ref } from "vue";
import type { Event } from "@/api/client";
import { api } from "@/api/client";

const events = ref<Event[]>([]);

export function useEvents() {
	async function load(query: Record<string, string> = {}) {
		events.value = await api.listEvents(query);
	}
	async function create(input: {
		calendar_id: string;
		title: string;
		start_at: string;
		end_at: string;
		all_day?: boolean;
	}) {
		await api.createEvent(input);
		await load();
	}
	async function remove(id: string) {
		await api.deleteEvent(id);
		await load();
	}
	return { events, load, create, remove };
}
