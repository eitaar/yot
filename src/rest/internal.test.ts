import assert from "node:assert/strict";
import { test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices } from "../services/container.js";
import { buildApp } from "./app.js";

function setup() {
	const db = openDb(":memory:");
	const bus = new EventBus();
	const services = createServices(db, bus);
	const writeKey = services.apiKeys.create("w", "write").raw;
	const readKey = services.apiKeys.create("r", "read").raw;
	const app = buildApp({ bus, services });
	return { app, bus, writeKey, readKey };
}

test("POST /api/internal/events with write key emits to bus and returns 204", async () => {
	const { app, bus, writeKey } = setup();
	const received: { type: string; data: unknown }[] = [];
	bus.subscribe((ev) => received.push(ev));

	const res = await app.request("/api/internal/events", {
		method: "POST",
		headers: {
			authorization: `Bearer ${writeKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ type: "event.created", data: { id: "abc" } }),
	});

	assert.equal(res.status, 204);
	assert.equal(received.length, 1);
	assert.equal(received[0].type, "event.created");
	assert.deepEqual(received[0].data, { id: "abc" });
});

test("POST /api/internal/events reaches SSE subscribers", async () => {
	const { app, writeKey } = setup();

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 4000);

	const sseRes = await app.request(`/api/stream?key=${writeKey}`, {
		signal: controller.signal,
	});
	assert.equal(sseRes.status, 200);
	assert.ok(sseRes.body);

	const reader = sseRes.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	async function nextEventName(): Promise<string> {
		for (;;) {
			const idx = buffer.indexOf("\n\n");
			if (idx !== -1) {
				const frame = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const match = frame.match(/event:\s*(.+)/);
				if (match) return match[1].trim();
				continue;
			}
			const { value, done } = await reader.read();
			if (done) throw new Error("stream ended unexpectedly");
			buffer += decoder.decode(value, { stream: true });
		}
	}

	assert.equal(await nextEventName(), "ready");

	await app.request("/api/internal/events", {
		method: "POST",
		headers: {
			authorization: `Bearer ${writeKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ type: "tag.created", data: { name: "work" } }),
	});

	assert.equal(await nextEventName(), "tag.created");

	controller.abort();
	clearTimeout(timer);
	await reader.cancel().catch(() => {});
});

test("POST /api/internal/events returns 401 without a key", async () => {
	const { app } = setup();
	const res = await app.request("/api/internal/events", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "event.created", data: {} }),
	});
	assert.equal(res.status, 401);
});

test("POST /api/internal/events returns 403 with a read key", async () => {
	const { app, readKey } = setup();
	const res = await app.request("/api/internal/events", {
		method: "POST",
		headers: {
			authorization: `Bearer ${readKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ type: "event.created", data: {} }),
	});
	assert.equal(res.status, 403);
});

test("POST /api/internal/events returns 400 for invalid type", async () => {
	const { app, writeKey } = setup();
	const res = await app.request("/api/internal/events", {
		method: "POST",
		headers: {
			authorization: `Bearer ${writeKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ type: "INVALID", data: {} }),
	});
	assert.equal(res.status, 400);
});
