import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices, type Services } from "../services/container.js";
import { buildApp } from "./app.js";

let app: ReturnType<typeof buildApp>;
let services: Services;
let writeKey: string;
let readKey: string;

const json = (body: unknown) => ({
	method: "POST",
	headers: {
		"content-type": "application/json",
		authorization: `Bearer ${writeKey}`,
	},
	body: JSON.stringify(body),
});

beforeEach(() => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	services = createServices(db, bus);
	writeKey = services.apiKeys.create("w", "write").raw;
	readKey = services.apiKeys.create("r", "read").raw;
	app = buildApp({ bus, services });
});

test("health is public and reports ok", async () => {
	const res = await app.request("/api/health");
	assert.equal(res.status, 200);
	assert.equal((await res.json()).status, "ok");
});

test("requests without an API key are rejected with 401", async () => {
	const res = await app.request("/api/calendars");
	assert.equal(res.status, 401);
});

test("a valid key authorizes reads", async () => {
	const res = await app.request("/api/calendars", {
		headers: { authorization: `Bearer ${readKey}` },
	});
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), []);
});

test("a read-only key is forbidden from mutating (403)", async () => {
	const res = await app.request("/api/calendars", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${readKey}`,
		},
		body: JSON.stringify({ name: "Nope" }),
	});
	assert.equal(res.status, 403);
});

test("full calendar + event CRUD flow over REST", async () => {
	const calRes = await app.request(
		"/api/calendars",
		json({ name: "Work", color: "#3b82f6" }),
	);
	assert.equal(calRes.status, 201);
	const cal = await calRes.json();

	const evRes = await app.request(
		"/api/events",
		json({
			calendar_id: cal.id,
			title: "Sync",
			start_at: "2026-05-29T10:00:00Z",
			end_at: "2026-05-29T11:00:00Z",
		}),
	);
	assert.equal(evRes.status, 201);
	const ev = await evRes.json();
	assert.equal(ev.title, "Sync");

	const listRes = await app.request(`/api/events?calendarId=${cal.id}&q=Sync`, {
		headers: { authorization: `Bearer ${writeKey}` },
	});
	assert.equal((await listRes.json()).length, 1);

	const delRes = await app.request(`/api/events/${ev.id}`, {
		method: "DELETE",
		headers: { authorization: `Bearer ${writeKey}` },
	});
	assert.equal(delRes.status, 204);
});

test("creating an event with end before start returns 400", async () => {
	const cal = await (
		await app.request("/api/calendars", json({ name: "C" }))
	).json();
	const res = await app.request(
		"/api/events",
		json({
			calendar_id: cal.id,
			title: "bad",
			start_at: "2026-05-29T11:00:00Z",
			end_at: "2026-05-29T10:00:00Z",
		}),
	);
	assert.equal(res.status, 400);
});

test("PATCH /tags/{id} updates a tag and 404s for an unknown id", async () => {
	const tag = await (
		await app.request("/api/tags", json({ name: "old", color: "#ef4444" }))
	).json();

	const patchRes = await app.request(`/api/tags/${tag.id}`, {
		method: "PATCH",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${writeKey}`,
		},
		body: JSON.stringify({ name: "new", color: "#10b981" }),
	});
	assert.equal(patchRes.status, 200);
	const updated = await patchRes.json();
	assert.equal(updated.id, tag.id);
	assert.equal(updated.name, "new");
	assert.equal(updated.color, "#10b981");

	const missingRes = await app.request("/api/tags/nope", {
		method: "PATCH",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${writeKey}`,
		},
		body: JSON.stringify({ name: "x" }),
	});
	assert.equal(missingRes.status, 404);
});

test("fetching an unknown calendar returns 404", async () => {
	const res = await app.request("/api/calendars/nope", {
		headers: { authorization: `Bearer ${writeKey}` },
	});
	assert.equal(res.status, 404);
});

test("serves an OpenAPI document", async () => {
	const res = await app.request("/api/doc");
	assert.equal(res.status, 200);
	const doc = await res.json();
	assert.equal(doc.openapi.startsWith("3."), true);
});

test("events REST round-trips url and image_path", async () => {
	const cal = await (
		await app.request("/api/calendars", json({ name: "Work" }))
	).json();

	const created = await (
		await app.request(
			"/api/events",
			json({
				calendar_id: cal.id,
				title: "Linked",
				start_at: "2026-05-29T10:00:00Z",
				end_at: "2026-05-29T11:00:00Z",
				url: "https://example.com",
				image_path: "11111111-1111-4111-8111-111111111111.png",
			}),
		)
	).json();
	assert.equal(created.url, "https://example.com");
	assert.equal(created.image_path, "11111111-1111-4111-8111-111111111111.png");
	assert.equal(created.source_uid, null);

	const patched = await (
		await app.request(`/api/events/${created.id}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${writeKey}`,
			},
			body: JSON.stringify({ url: null }),
		})
	).json();
	assert.equal(patched.url, null);
});

test("rejects a javascript: url with 400 (XSS guard)", async () => {
	const cal = await (
		await app.request("/api/calendars", json({ name: "X" }))
	).json();
	const res = await app.request(
		"/api/events",
		json({
			calendar_id: cal.id,
			title: "evil",
			start_at: "2026-05-29T10:00:00Z",
			end_at: "2026-05-29T11:00:00Z",
			url: "javascript:alert(1)",
		}),
	);
	assert.equal(res.status, 400);
});
