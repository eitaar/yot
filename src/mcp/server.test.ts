import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices, type Services } from "../services/container.js";
import { buildMcpServer } from "./server.js";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:timed-1
SUMMARY:Timed meeting
DTSTART:20260602T140000Z
DTEND:20260602T150000Z
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
SUMMARY:Standup
DTSTART:20260601T090000Z
DTEND:20260601T091500Z
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`;

let services: Services;
let imgDir: string;
let calId: string;

beforeEach(() => {
	imgDir = mkdtempSync(join(tmpdir(), "yot-mcp-"));
	process.env.IMG_DIR = imgDir;
	const db = openDb(":memory:");
	services = createServices(db, new EventBus());
	calId = services.calendars.create({ name: "Work" }).id;
});
afterEach(() => {
	rmSync(imgDir, { recursive: true, force: true });
	delete process.env.IMG_DIR;
});

/** Build a server at the given scope and return a connected in-memory client. */
async function connect(scope: "read" | "write"): Promise<Client> {
	const server = buildMcpServer(services, scope);
	const [clientT, serverT] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test", version: "0.0.0" });
	await server.connect(serverT);
	await client.connect(clientT);
	return client;
}

function call(
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
) {
	return client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
}

function textOf(result: CallToolResult): string {
	const first = result.content[0];
	return first.type === "text" ? first.text : "";
}

function seedEventWithCover(): { eventId: string; name: string } {
	const name = services.images.saveBytes(
		new Uint8Array([1, 2, 3]),
		"image/png",
	);
	const ev = services.events.create({
		calendar_id: calId,
		title: "Cover",
		start_at: "2026-06-10T09:00:00Z",
		end_at: "2026-06-10T10:00:00Z",
		all_day: false,
		image_path: name,
	});
	return { eventId: ev.id, name };
}

test("get_event_image returns a viewable image block for a cover", async () => {
	const { eventId } = seedEventWithCover();
	const client = await connect("write");

	const result = await call(client, "get_event_image", { id: eventId });
	const block = result.content[0];
	assert.equal(block.type, "image");
	assert.equal(block.mimeType, "image/png");
	assert.equal(block.data, Buffer.from([1, 2, 3]).toString("base64"));
});

test("get_event_image returns a message when the event has no cover", async () => {
	const ev = services.events.create({
		calendar_id: calId,
		title: "Bare",
		start_at: "2026-06-10T09:00:00Z",
		end_at: "2026-06-10T10:00:00Z",
		all_day: false,
	});
	const client = await connect("write");

	const result = await call(client, "get_event_image", { id: ev.id });
	assert.equal(result.content[0].type, "text");
	assert.match(textOf(result), /no cover image/);
});

test("upload_image_from_url refuses a private/loopback host", async () => {
	const client = await connect("write");
	const result = await call(client, "upload_image_from_url", {
		url: "http://127.0.0.1/x.png",
	});
	assert.equal(result.isError, true);
});

test("remove_reminder detaches a reminder", async () => {
	const ev = services.events.create({
		calendar_id: calId,
		title: "X",
		start_at: "2026-06-10T09:00:00Z",
		end_at: "2026-06-10T10:00:00Z",
		all_day: false,
	});
	const reminder = services.events.addReminder(ev.id, { minutes_before: 10 });
	const client = await connect("write");

	const result = await call(client, "remove_reminder", {
		event_id: ev.id,
		reminder_id: reminder.id,
	});
	assert.notEqual(result.isError, true);
	assert.equal(services.events.get(ev.id).reminders.length, 0);
});

test("update_tag and delete_tag mutate the tag", async () => {
	const tag = services.tags.create({ name: "old" });
	const client = await connect("write");

	const updated = await call(client, "update_tag", { id: tag.id, name: "new" });
	assert.equal(JSON.parse(textOf(updated)).name, "new");

	const deleted = await call(client, "delete_tag", { id: tag.id });
	assert.notEqual(deleted.isError, true);
	assert.equal(services.tags.list().length, 0);
});

test("import_ics creates one-off events and skips recurring", async () => {
	const client = await connect("write");
	const result = await call(client, "import_ics", {
		calendar_id: calId,
		ics: ICS,
	});
	const summary = JSON.parse(textOf(result));
	assert.equal(summary.created, 1);
	assert.equal(summary.skippedRecurring, 1);
});

test("import_ics into an unknown calendar errors", async () => {
	const client = await connect("write");
	const result = await call(client, "import_ics", {
		calendar_id: "missing",
		ics: ICS,
	});
	assert.equal(result.isError, true);
	assert.match(textOf(result), /not found/i);
});

test("read scope blocks new write tools but allows get_event_image", async () => {
	const { eventId } = seedEventWithCover();
	const client = await connect("read");

	const writeCalls: [string, Record<string, unknown>][] = [
		["upload_image_from_url", { url: "https://example.com/a.png" }],
		["remove_reminder", { event_id: "x", reminder_id: "y" }],
		["update_tag", { id: "x", name: "y" }],
		["delete_tag", { id: "x" }],
		["import_ics", { calendar_id: calId, ics: ICS }],
	];
	for (const [name, args] of writeCalls) {
		const result = await call(client, name, args);
		assert.equal(result.isError, true, `${name} should be blocked`);
		assert.match(textOf(result), /read-only/, `${name} message`);
	}

	const image = await call(client, "get_event_image", { id: eventId });
	assert.equal(image.content[0].type, "image");
});
