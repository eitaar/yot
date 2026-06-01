import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthEnv } from "../auth/middleware.js";
import { ValidationError } from "../core/errors.js";
import type { Services } from "../services/container.js";

/** Multipart .ics import. Plain Hono route (not OpenAPI-documented). */
export function registerImportRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ importer, calendars }: Services,
): void {
	api.post("/events/import", async (c) => {
		const body = await c.req.parseBody();
		const file = body.file;
		const calendarId = body.calendar_id;
		if (!(file instanceof File))
			throw new ValidationError("Expected a 'file' field");
		if (typeof calendarId !== "string" || !calendarId)
			throw new ValidationError("Expected a 'calendar_id' field");
		calendars.get(calendarId); // throws NotFoundError (404) for an unknown id
		if (file.size > 10 * 1024 * 1024)
			throw new ValidationError("File too large (max 10 MB)");
		const text = await file.text();
		return c.json(importer.importIcs(text, calendarId), 200);
	});
}
