import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthEnv } from "../auth/middleware.js";
import {
	CreateEventSchema,
	CreateReminderSchema,
	EventQuerySchema,
	EventSchema,
	ReminderSchema,
	UpdateEventSchema,
} from "../schemas/event.js";
import type { Services } from "../services/container.js";

const IdParam = z.object({ id: z.string() });
const tags = ["events"];
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({
	content: { "application/json": { schema } },
});

export function registerEventRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ events }: Services,
): void {
	api.openapi(
		createRoute({
			method: "get",
			path: "/events",
			tags,
			request: { query: EventQuerySchema },
			responses: {
				200: {
					description: "Matching events",
					...jsonBody(z.array(EventSchema)),
				},
			},
		}),
		(c) => c.json(events.list(c.req.valid("query")), 200),
	);

	api.openapi(
		createRoute({
			method: "post",
			path: "/events",
			tags,
			request: { body: jsonBody(CreateEventSchema) },
			responses: { 201: { description: "Created", ...jsonBody(EventSchema) } },
		}),
		(c) => c.json(events.create(c.req.valid("json")), 201),
	);

	api.openapi(
		createRoute({
			method: "get",
			path: "/events/{id}",
			tags,
			request: { params: IdParam },
			responses: {
				200: { description: "An event", ...jsonBody(EventSchema) },
				404: { description: "Not found" },
			},
		}),
		(c) => c.json(events.get(c.req.valid("param").id), 200),
	);

	api.openapi(
		createRoute({
			method: "patch",
			path: "/events/{id}",
			tags,
			request: { params: IdParam, body: jsonBody(UpdateEventSchema) },
			responses: {
				200: { description: "Updated", ...jsonBody(EventSchema) },
				404: { description: "Not found" },
			},
		}),
		(c) =>
			c.json(events.update(c.req.valid("param").id, c.req.valid("json")), 200),
	);

	api.openapi(
		createRoute({
			method: "delete",
			path: "/events/{id}",
			tags,
			request: { params: IdParam },
			responses: {
				204: { description: "Deleted" },
				404: { description: "Not found" },
			},
		}),
		(c) => {
			events.delete(c.req.valid("param").id);
			return c.body(null, 204);
		},
	);

	api.openapi(
		createRoute({
			method: "post",
			path: "/events/{id}/reminders",
			tags,
			request: { params: IdParam, body: jsonBody(CreateReminderSchema) },
			responses: {
				201: { description: "Reminder added", ...jsonBody(ReminderSchema) },
				404: { description: "Event not found" },
			},
		}),
		(c) =>
			c.json(
				events.addReminder(c.req.valid("param").id, c.req.valid("json")),
				201,
			),
	);

	api.openapi(
		createRoute({
			method: "delete",
			path: "/events/{id}/reminders/{rid}",
			tags,
			request: { params: z.object({ id: z.string(), rid: z.string() }) },
			responses: {
				204: { description: "Removed" },
				404: { description: "Not found" },
			},
		}),
		(c) => {
			const { id, rid } = c.req.valid("param");
			events.removeReminder(id, rid);
			return c.body(null, 204);
		},
	);

	api.openapi(
		createRoute({
			method: "post",
			path: "/events/{id}/tags/{tagId}",
			tags,
			request: { params: z.object({ id: z.string(), tagId: z.string() }) },
			responses: {
				200: { description: "Tag attached", ...jsonBody(EventSchema) },
				404: { description: "Event or tag not found" },
			},
		}),
		(c) => {
			const { id, tagId } = c.req.valid("param");
			return c.json(events.addTag(id, tagId), 200);
		},
	);

	api.openapi(
		createRoute({
			method: "delete",
			path: "/events/{id}/tags/{tagId}",
			tags,
			request: { params: z.object({ id: z.string(), tagId: z.string() }) },
			responses: {
				200: { description: "Tag detached", ...jsonBody(EventSchema) },
				404: { description: "Event not found" },
			},
		}),
		(c) => {
			const { id, tagId } = c.req.valid("param");
			return c.json(events.removeTag(id, tagId), 200);
		},
	);
}
