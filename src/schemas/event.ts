import { z } from "@hono/zod-openapi";
import { isHttpUrl, isoDateTime } from "./common.js";

const httpUrl = () =>
	z.string().refine(isHttpUrl, "url must be an http(s) URL");

export const ReminderSchema = z
	.object({
		id: z.string(),
		event_id: z.string(),
		minutes_before: z.number().int().openapi({ example: 10 }),
		method: z.string().openapi({ example: "notification" }),
	})
	.openapi("Reminder");

export const EventSchema = z
	.object({
		id: z.string(),
		calendar_id: z.string(),
		title: z.string().openapi({ example: "Team sync" }),
		description: z.string().nullable(),
		location: z.string().nullable().openapi({ example: "Room 4" }),
		start_at: isoDateTime(),
		end_at: isoDateTime("2026-05-29T11:00:00.000Z"),
		all_day: z.boolean(),
		image_path: z.string().nullable(),
		url: z.string().nullable(),
		source_uid: z.string().nullable(),
		created_at: isoDateTime(),
		updated_at: isoDateTime(),
		tags: z
			.array(z.string())
			.openapi({ description: "tag names attached to the event" }),
		reminders: z.array(ReminderSchema),
	})
	.openapi("Event");

export const CreateEventSchema = z
	.object({
		calendar_id: z.string().min(1),
		title: z.string().min(1).openapi({ example: "Team sync" }),
		description: z.string().optional(),
		location: z.string().optional(),
		start_at: isoDateTime(),
		end_at: isoDateTime("2026-05-29T11:00:00.000Z"),
		all_day: z.boolean().optional().default(false),
		url: httpUrl().optional(),
		image_path: z.string().optional(),
	})
	.openapi("CreateEvent");

export const UpdateEventSchema = z
	.object({
		calendar_id: z.string().min(1).optional(),
		title: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		location: z.string().nullable().optional(),
		start_at: isoDateTime().optional(),
		end_at: isoDateTime().optional(),
		all_day: z.boolean().optional(),
		url: httpUrl().nullable().optional(),
		image_path: z.string().nullable().optional(),
	})
	.openapi("UpdateEvent");

export const EventQuerySchema = z
	.object({
		calendarId: z.string().optional(),
		from: z
			.string()
			.optional()
			.openapi({ description: "lower bound on start_at (inclusive)" }),
		to: z
			.string()
			.optional()
			.openapi({ description: "upper bound on start_at (inclusive)" }),
		tag: z
			.string()
			.optional()
			.openapi({ description: "filter to events carrying this tag name" }),
		q: z
			.string()
			.optional()
			.openapi({ description: "search in title and description" }),
		limit: z.coerce.number().int().min(1).max(500).optional().default(50),
		offset: z.coerce.number().int().min(0).optional().default(0),
	})
	.openapi("EventQuery");

export const CreateReminderSchema = z
	.object({
		minutes_before: z.number().int().min(0).openapi({ example: 10 }),
		method: z.string().optional().default("notification"),
	})
	.openapi("CreateReminder");

export type Event = z.infer<typeof EventSchema>;
export type Reminder = z.infer<typeof ReminderSchema>;
export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;
export type EventQuery = z.infer<typeof EventQuerySchema>;
export type CreateReminderInput = z.infer<typeof CreateReminderSchema>;
