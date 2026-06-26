import { ref } from "vue";
import type { Calendar, CalendarUpdate } from "@/api/client";
import { ApiError, api } from "@/api/client";
import { getAll, getDB, replaceAll } from "@/lib/db";
import { queueMutation } from "@/lib/syncQueue";

const calendars = ref<Calendar[]>([]);

function isNetworkError(e: unknown): boolean {
	return !(e instanceof ApiError);
}

export function useCalendars() {
	async function load() {
		calendars.value = await getAll("calendars");

		api
			.listCalendars()
			.then(async (result) => {
				calendars.value = result;
				await replaceAll("calendars", result);
			})
			.catch(() => {});
	}

	async function create(name: string, color?: string) {
		const input = { name, ...(color ? { color } : {}) };
		try {
			await api.createCalendar(input);
			await load();
			return;
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}
		const tempId = `temp-${crypto.randomUUID()}`;
		const tempCal: Calendar = {
			id: tempId,
			name,
			color: color ?? null,
			description: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
		calendars.value = [...calendars.value, tempCal];
		const db = await getDB();
		await db.put("calendars", tempCal);
		await queueMutation({
			resource: "calendar",
			action: "create",
			tempId,
			payload: input,
		});
	}

	async function update(id: string, input: CalendarUpdate) {
		try {
			await api.updateCalendar(id, input);
			await load();
			return;
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}
		const idx = calendars.value.findIndex((c) => c.id === id);
		if (idx !== -1) {
			const patched = {
				...calendars.value[idx],
				...input,
				updated_at: new Date().toISOString(),
			};
			calendars.value[idx] = patched;
			const db = await getDB();
			await db.put("calendars", patched);
		}
		await queueMutation({
			resource: "calendar",
			action: "update",
			id,
			payload: input,
		});
	}

	return { calendars, load, create, update };
}
