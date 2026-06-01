import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthEnv } from "../auth/middleware.js";
import { ValidationError } from "../core/errors.js";
import type { Services } from "../services/container.js";

/** Multipart .ics import. Plain Hono route (not OpenAPI-documented). */
export function registerImportRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ importer }: Services,
): void {
	api.post("/events/import", async (c) => {
		const body = await c.req.parseBody();
		const file = body.file;
		const calendarId = body.calendar_id;
		if (!(file instanceof File))
			throw new ValidationError("Expected a 'file' field");
		if (typeof calendarId !== "string" || !calendarId)
			throw new ValidationError("Expected a 'calendar_id' field");
		const text = await file.text();
		return c.json(importer.importIcs(text, calendarId), 200);
	});
}
