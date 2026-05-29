import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthEnv } from "../auth/middleware.js";
import {
	CalendarSchema,
	CreateCalendarSchema,
	UpdateCalendarSchema,
} from "../schemas/calendar.js";
import type { Services } from "../services/container.js";

const IdParam = z.object({ id: z.string() });
const tags = ["calendars"];
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({
	content: { "application/json": { schema } },
});

export function registerCalendarRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ calendars }: Services,
): void {
	api.openapi(
		createRoute({
			method: "get",
			path: "/calendars",
			tags,
			responses: {
				200: {
					description: "All calendars",
					...jsonBody(z.array(CalendarSchema)),
				},
			},
		}),
		(c) => c.json(calendars.list(), 200),
	);

	api.openapi(
		createRoute({
			method: "post",
			path: "/calendars",
			tags,
			request: { body: jsonBody(CreateCalendarSchema) },
			responses: {
				201: { description: "Created", ...jsonBody(CalendarSchema) },
			},
		}),
		(c) => c.json(calendars.create(c.req.valid("json")), 201),
	);

	api.openapi(
		createRoute({
			method: "get",
			path: "/calendars/{id}",
			tags,
			request: { params: IdParam },
			responses: {
				200: { description: "A calendar", ...jsonBody(CalendarSchema) },
				404: { description: "Not found" },
			},
		}),
		(c) => c.json(calendars.get(c.req.valid("param").id), 200),
	);

	api.openapi(
		createRoute({
			method: "patch",
			path: "/calendars/{id}",
			tags,
			request: { params: IdParam, body: jsonBody(UpdateCalendarSchema) },
			responses: {
				200: { description: "Updated", ...jsonBody(CalendarSchema) },
				404: { description: "Not found" },
			},
		}),
		(c) =>
			c.json(
				calendars.update(c.req.valid("param").id, c.req.valid("json")),
				200,
			),
	);

	api.openapi(
		createRoute({
			method: "delete",
			path: "/calendars/{id}",
			tags,
			request: { params: IdParam },
			responses: {
				204: { description: "Deleted" },
				404: { description: "Not found" },
			},
		}),
		(c) => {
			calendars.delete(c.req.valid("param").id);
			return c.body(null, 204);
		},
	);
}
