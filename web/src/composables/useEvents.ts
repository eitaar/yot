import { ref } from "vue";
import type { Event, EventUpdate } from "@/api/client";
import { ApiError, api, imageSrc } from "@/api/client";
import { getAll, getDB, replaceAll } from "@/lib/db";
import { queueMutation } from "@/lib/syncQueue";

function precacheImages(events: Event[]) {
	for (const e of events) {
		if (e.image_path) fetch(imageSrc(e.image_path)).catch(() => {});
	}
}

const events = ref<Event[]>([]);

function isNetworkError(e: unknown): boolean {
	return !(e instanceof ApiError);
}

export function useEvents() {
	async function load(query: Record<string, string> = { limit: "500" }) {
		events.value = await getAll("events");
		precacheImages(events.value);

		api
			.listEvents(query)
			.then(async (result) => {
				events.value = result;
				await replaceAll("events", result);
				precacheImages(result);
			})
			.catch(() => {});
	}

	async function create(
		input: Parameters<typeof api.createEvent>[0],
	): Promise<Event> {
		try {
			return await api.createEvent(input);
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}

		const tempId = `temp-${crypto.randomUUID()}`;
		const tempEvent: Event = {
			id: tempId,
			calendar_id: input.calendar_id,
			title: input.title,
			description: input.description ?? null,
			location: input.location ?? null,
			start_at: input.start_at,
			end_at: input.end_at,
			all_day: input.all_day ?? false,
			image_path: input.image_path ?? null,
			url: input.url ?? null,
			source_uid: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			tags: [],
			reminders: [],
		};
		events.value = [...events.value, tempEvent];
		const db = await getDB();
		await db.put("events", tempEvent);
		await queueMutation({
			resource: "event",
			action: "create",
			tempId,
			payload: input,
		});
		return tempEvent;
	}

	async function update(id: string, input: EventUpdate) {
		try {
			await api.updateEvent(id, input);
			return;
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}
		const idx = events.value.findIndex((e) => e.id === id);
		if (idx !== -1) {
			const patched = {
				...events.value[idx],
				...input,
				updated_at: new Date().toISOString(),
			};
			events.value[idx] = patched;
			const db = await getDB();
			await db.put("events", patched);
		}
		await queueMutation({
			resource: "event",
			action: "update",
			id,
			payload: input,
		});
	}

	async function remove(id: string) {
		try {
			await api.deleteEvent(id);
			return;
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}
		events.value = events.value.filter((e) => e.id !== id);
		const db = await getDB();
		await db.delete("events", id);
		await queueMutation({ resource: "event", action: "delete", id });
	}

	async function addTag(eventId: string, tagId: string) {
		try {
			await api.addEventTag(eventId, tagId);
			return;
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}
		const db = await getDB();
		const tag = await db.get("tags", tagId);
		if (tag) {
			const idx = events.value.findIndex((e) => e.id === eventId);
			if (idx !== -1 && !events.value[idx].tags.includes(tag.name)) {
				events.value[idx] = {
					...events.value[idx],
					tags: [...events.value[idx].tags, tag.name],
				};
				await db.put("events", events.value[idx]);
			}
		}
		await queueMutation({
			resource: "event",
			action: "addTag",
			id: eventId,
			payload: tagId,
		});
	}

	async function removeTag(eventId: string, tagId: string) {
		try {
			await api.removeEventTag(eventId, tagId);
			return;
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}
		const db = await getDB();
		const tag = await db.get("tags", tagId);
		if (tag) {
			const idx = events.value.findIndex((e) => e.id === eventId);
			if (idx !== -1) {
				events.value[idx] = {
					...events.value[idx],
					tags: events.value[idx].tags.filter((t) => t !== tag.name),
				};
				await db.put("events", events.value[idx]);
			}
		}
		await queueMutation({
			resource: "event",
			action: "removeTag",
			id: eventId,
			payload: tagId,
		});
	}

	return { events, load, create, update, remove, addTag, removeTag };
}
