import { z } from "@hono/zod-openapi";
import { isoDateTime } from "./common.js";

export const CalendarSchema = z
	.object({
		id: z.string().openapi({ example: "9b1c..." }),
		name: z.string().openapi({ example: "Work" }),
		color: z.string().nullable().openapi({ example: "#3b82f6" }),
		description: z.string().nullable(),
		created_at: isoDateTime(),
		updated_at: isoDateTime(),
	})
	.openapi("Calendar");

export const CreateCalendarSchema = z
	.object({
		name: z.string().min(1).openapi({ example: "Work" }),
		color: z.string().optional().openapi({ example: "#3b82f6" }),
		description: z.string().optional(),
	})
	.openapi("CreateCalendar");

export const UpdateCalendarSchema = z
	.object({
		name: z.string().min(1).optional(),
		color: z.string().nullable().optional(),
		description: z.string().nullable().optional(),
	})
	.openapi("UpdateCalendar");

export type Calendar = z.infer<typeof CalendarSchema>;
export type CreateCalendarInput = z.infer<typeof CreateCalendarSchema>;
export type UpdateCalendarInput = z.infer<typeof UpdateCalendarSchema>;
