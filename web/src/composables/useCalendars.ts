import { ref } from "vue";
import type { Calendar } from "@/api/client";
import { api } from "@/api/client";

const calendars = ref<Calendar[]>([]);

export function useCalendars() {
	async function load() {
		calendars.value = await api.listCalendars();
	}
	async function create(name: string, color?: string) {
		await api.createCalendar({ name, ...(color ? { color } : {}) });
		await load();
	}
	async function remove(id: string) {
		await api.deleteCalendar(id);
		await load();
	}
	return { calendars, load, create, remove };
}
