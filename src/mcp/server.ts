import { z } from "@hono/zod-openapi";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Scope } from "../auth/apikey.js";
import { ForbiddenError } from "../core/errors.js";
import {
	CreateCalendarSchema,
	UpdateCalendarSchema,
} from "../schemas/calendar.js";
import {
	CreateEventSchema,
	CreateReminderSchema,
	EventQuerySchema,
	UpdateEventSchema,
} from "../schemas/event.js";
import { CreateTagSchema, UpdateTagSchema } from "../schemas/tag.js";
import type { Services } from "../services/container.js";

const idShape = { id: z.string() };

/** Run a service call and shape the result (or error) as an MCP tool result. */
async function run(fn: () => unknown): Promise<CallToolResult> {
	return runResult(async () => {
		const data = await fn();
		return {
			content: [
				{ type: "text", text: JSON.stringify(data ?? { ok: true }, null, 2) },
			],
		};
	});
}

/**
 * Like `run`, but the callback builds the whole tool result — used by tools that
 * return non-JSON content (e.g. an image block). Thrown errors get the same
 * `isError` text shaping as `run`.
 */
async function runResult(
	fn: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
	try {
		return await fn();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { content: [{ type: "text", text: message }], isError: true };
	}
}

/**
 * Build an MCP server exposing the same CRUD operations as the REST API, backed
 * by the shared services. `scope` is the authenticated key's scope: write tools
 * refuse to run for read-only keys.
 */
export function buildMcpServer(services: Services, scope: Scope): McpServer {
	const { calendars, events, tags, images, importer } = services;
	const server = new McpServer({ name: "yot-calendar", version: "1.0.0" });
	const requireWrite = () => {
		if (scope !== "write")
			throw new ForbiddenError("This API key is read-only");
	};

	// --- calendars ---
	server.registerTool(
		"list_calendars",
		{ description: "List all calendars" },
		() => run(() => calendars.list()),
	);
	server.registerTool(
		"create_calendar",
		{
			description: "Create a calendar",
			inputSchema: CreateCalendarSchema.shape,
		},
		(args) =>
			run(() => {
				requireWrite();
				return calendars.create(args);
			}),
	);
	server.registerTool(
		"update_calendar",
		{
			description: "Update a calendar",
			inputSchema: { ...idShape, ...UpdateCalendarSchema.shape },
		},
		({ id, ...patch }) =>
			run(() => {
				requireWrite();
				return calendars.update(id, patch);
			}),
	);
	server.registerTool(
		"delete_calendar",
		{ description: "Delete a calendar", inputSchema: idShape },
		({ id }) =>
			run(() => {
				requireWrite();
				calendars.delete(id);
			}),
	);

	// --- events ---
	server.registerTool(
		"list_events",
		{
			description: "List events with optional filters",
			inputSchema: EventQuerySchema.shape,
		},
		(args) => run(() => events.list(EventQuerySchema.parse(args))),
	);
	server.registerTool(
		"get_event",
		{ description: "Get one event by id", inputSchema: idShape },
		({ id }) => run(() => events.get(id)),
	);
	server.registerTool(
		"create_event",
		{ description: "Create an event", inputSchema: CreateEventSchema.shape },
		(args) =>
			run(() => {
				requireWrite();
				return events.create(CreateEventSchema.parse(args));
			}),
	);
	server.registerTool(
		"update_event",
		{
			description: "Update an event",
			inputSchema: { ...idShape, ...UpdateEventSchema.shape },
		},
		({ id, ...patch }) =>
			run(() => {
				requireWrite();
				return events.update(id, patch);
			}),
	);
	server.registerTool(
		"delete_event",
		{ description: "Delete an event", inputSchema: idShape },
		({ id }) =>
			run(() => {
				requireWrite();
				events.delete(id);
			}),
	);
	server.registerTool(
		"add_reminder",
		{
			description: "Add a reminder to an event",
			inputSchema: { event_id: z.string(), ...CreateReminderSchema.shape },
		},
		({ event_id, ...rest }) =>
			run(() => {
				requireWrite();
				return events.addReminder(event_id, CreateReminderSchema.parse(rest));
			}),
	);
	server.registerTool(
		"remove_reminder",
		{
			description: "Remove a reminder from an event",
			inputSchema: { event_id: z.string(), reminder_id: z.string() },
		},
		({ event_id, reminder_id }) =>
			run(() => {
				requireWrite();
				events.removeReminder(event_id, reminder_id);
			}),
	);
	server.registerTool(
		"get_event_image",
		{
			description:
				"Get an event's cover image as a viewable image. Returns a message if the event has no cover.",
			inputSchema: idShape,
		},
		({ id }) =>
			runResult(() => {
				const event = events.get(id);
				if (!event.image_path)
					return {
						content: [{ type: "text", text: `Event ${id} has no cover image` }],
					};
				const { bytes, mime } = images.read(event.image_path);
				return {
					content: [
						{ type: "image", data: bytes.toString("base64"), mimeType: mime },
					],
				};
			}),
	);

	// --- images ---
	server.registerTool(
		"upload_image_from_url",
		{
			description:
				"Fetch a remote image into local storage and return its { path }, " +
				"suitable for an event's image_path. http(s) only; ≤ 5 MB.",
			inputSchema: { url: z.string() },
		},
		({ url }) =>
			run(async () => {
				requireWrite();
				return { path: await images.saveFromUrl(url) };
			}),
	);

	// --- import ---
	server.registerTool(
		"import_ics",
		{
			description:
				"Import iCalendar (.ics) text into a calendar as one-off events. " +
				"Skips recurring (RRULE) and already-imported (UID) events.",
			inputSchema: { calendar_id: z.string(), ics: z.string() },
		},
		({ calendar_id, ics }) =>
			run(() => {
				requireWrite();
				calendars.get(calendar_id); // throws NotFoundError for an unknown id
				return importer.importIcs(ics, calendar_id);
			}),
	);

	// --- tags ---
	server.registerTool("list_tags", { description: "List all tags" }, () =>
		run(() => tags.list()),
	);
	server.registerTool(
		"create_tag",
		{ description: "Create a tag", inputSchema: CreateTagSchema.shape },
		(args) =>
			run(() => {
				requireWrite();
				return tags.create(args);
			}),
	);
	server.registerTool(
		"update_tag",
		{
			description: "Update a tag",
			inputSchema: { ...idShape, ...UpdateTagSchema.shape },
		},
		({ id, ...patch }) =>
			run(() => {
				requireWrite();
				return tags.update(id, patch);
			}),
	);
	server.registerTool(
		"delete_tag",
		{ description: "Delete a tag", inputSchema: idShape },
		({ id }) =>
			run(() => {
				requireWrite();
				tags.delete(id);
			}),
	);
	server.registerTool(
		"tag_event",
		{
			description: "Attach an existing tag to an event",
			inputSchema: { event_id: z.string(), tag_id: z.string() },
		},
		({ event_id, tag_id }) =>
			run(() => {
				requireWrite();
				return events.addTag(event_id, tag_id);
			}),
	);
	server.registerTool(
		"untag_event",
		{
			description: "Detach a tag from an event",
			inputSchema: { event_id: z.string(), tag_id: z.string() },
		},
		({ event_id, tag_id }) =>
			run(() => {
				requireWrite();
				return events.removeTag(event_id, tag_id);
			}),
	);

	return server;
}
