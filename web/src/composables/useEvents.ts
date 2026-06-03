import { ref } from "vue";
import type { Event, EventUpdate } from "@/api/client";
import { api } from "@/api/client";

const events = ref<Event[]>([]);

export function useEvents() {
	// One broad fetch feeds every view; filtering is client-side (see useFilters).
	// 500 is the server's max page size — enough headroom for the client filters.
	async function load(query: Record<string, string> = { limit: "500" }) {
		events.value = await api.listEvents(query);
	}
	// Mutations don't reload here: callers refresh once (scoped + coalesced) after
	// the mutation, and the SSE broadcast triggers the same refresh. Reloading
	// here too would fetch the full list an extra time, with the wrong query.
	async function create(
		input: Parameters<typeof api.createEvent>[0],
	): Promise<Event> {
		return await api.createEvent(input);
	}
	async function update(id: string, input: EventUpdate) {
		await api.updateEvent(id, input);
	}
	async function remove(id: string) {
		await api.deleteEvent(id);
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
