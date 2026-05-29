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
import { CreateTagSchema } from "../schemas/tag.js";
import type { Services } from "../services/container.js";

const idShape = { id: z.string() };

/** Run a service call and shape the result (or error) as an MCP tool result. */
async function run(fn: () => unknown): Promise<CallToolResult> {
	try {
		const data = await fn();
		return {
			content: [
				{ type: "text", text: JSON.stringify(data ?? { ok: true }, null, 2) },
			],
		};
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
	const { calendars, events, tags } = services;
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
