import { ref } from "vue";
import type { Event, EventUpdate } from "@/api/client";
import { api } from "@/api/client";

const events = ref<Event[]>([]);

export function useEvents() {
	async function load(query: Record<string, string> = {}) {
		events.value = await api.listEvents(query);
	}
	async function create(
		input: Parameters<typeof api.createEvent>[0],
	): Promise<Event> {
		const created = await api.createEvent(input);
		await load();
		return created;
	}
	async function update(id: string, input: EventUpdate) {
		await api.updateEvent(id, input);
		await load();
	}
	async function remove(id: string) {
		await api.deleteEvent(id);
		await load();
	}
	// Tag assign/unassign: no reload — the modal batches these then refreshes once.
	async function addTag(eventId: string, tagId: string) {
		await api.addEventTag(eventId, tagId);
	}
	async function removeTag(eventId: string, tagId: string) {
		await api.removeEventTag(eventId, tagId);
	}
	return { events, load, create, update, remove, addTag, removeTag };
}
