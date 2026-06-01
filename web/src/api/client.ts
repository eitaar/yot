export type Calendar = {
	id: string;
	name: string;
	color: string | null;
	description: string | null;
	created_at: string;
	updated_at: string;
};

export type Event = {
	id: string;
	calendar_id: string;
	title: string;
	description: string | null;
	location: string | null;
	start_at: string;
	end_at: string;
	all_day: boolean;
	created_at: string;
	updated_at: string;
	tags: string[];
	reminders: {
		id: string;
		event_id: string;
		minutes_before: number;
		method: string;
	}[];
};

export type Tag = {
	id: string;
	name: string;
	color: string | null;
};

// Mirrors the backend UpdateEvent schema (all fields optional).
export type EventUpdate = Partial<{
	calendar_id: string;
	title: string;
	description: string | null;
	location: string | null;
	start_at: string;
	end_at: string;
	all_day: boolean;
	tags: string[];
}>;

export type CalendarUpdate = Partial<{
	name: string;
	color: string | null;
	description: string | null;
}>;
export type TagUpdate = Partial<{ name: string; color: string | null }>;

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
	}
}

let unauthorizedHandler: (() => void) | null = null;

/** Register a callback invoked whenever any request returns 401. */
export function setUnauthorizedHandler(fn: () => void): void {
	unauthorizedHandler = fn;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const res = await fetch(`/api${path}`, {
		...options,
		credentials: "include",
		headers: { "content-type": "application/json", ...(options.headers ?? {}) },
	});
	if (res.status === 204) return undefined as T;
	const text = await res.text();
	const body = text ? JSON.parse(text) : null;
	if (!res.ok) {
		if (res.status === 401) unauthorizedHandler?.();
		const message = body?.error?.message ?? res.statusText;
		throw new ApiError(res.status, message);
	}
	return body as T;
}

export const api = {
	session: () => request<{ scope: "read" | "write" }>("/auth/session"),
	pair: (pin: string) =>
		request<{ ok: true; scope: string }>("/auth/pair", {
			method: "POST",
			body: JSON.stringify({ pin }),
		}),
	logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

	listCalendars: () => request<Calendar[]>("/calendars"),
	createCalendar: (input: { name: string; color?: string }) =>
		request<Calendar>("/calendars", {
			method: "POST",
			body: JSON.stringify(input),
		}),
	updateCalendar: (id: string, input: CalendarUpdate) =>
		request<Calendar>(`/calendars/${id}`, {
			method: "PATCH",
			body: JSON.stringify(input),
		}),

	listEvents: (query: Record<string, string> = {}) => {
		const qs = new URLSearchParams(query).toString();
		return request<Event[]>(`/events${qs ? `?${qs}` : ""}`);
	},
	createEvent: (input: {
		calendar_id: string;
		title: string;
		start_at: string;
		end_at: string;
		all_day?: boolean;
		location?: string;
		description?: string;
	}) =>
		request<Event>("/events", { method: "POST", body: JSON.stringify(input) }),
	getEvent: (id: string) => request<Event>(`/events/${id}`),
	updateEvent: (id: string, input: EventUpdate) =>
		request<Event>(`/events/${id}`, {
			method: "PATCH",
			body: JSON.stringify(input),
		}),
	deleteEvent: (id: string) =>
		request<void>(`/events/${id}`, { method: "DELETE" }),
	addEventTag: (eventId: string, tagId: string) =>
		request<Event>(`/events/${eventId}/tags/${tagId}`, { method: "POST" }),
	removeEventTag: (eventId: string, tagId: string) =>
		request<Event>(`/events/${eventId}/tags/${tagId}`, { method: "DELETE" }),

	listTags: () => request<Tag[]>("/tags"),
	createTag: (input: { name: string; color?: string }) =>
		request<Tag>("/tags", { method: "POST", body: JSON.stringify(input) }),
	updateTag: (id: string, input: TagUpdate) =>
		request<Tag>(`/tags/${id}`, {
			method: "PATCH",
			body: JSON.stringify(input),
		}),
	deleteTag: (id: string) => request<void>(`/tags/${id}`, { method: "DELETE" }),
};
