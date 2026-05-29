import assert from "node:assert/strict";
import { test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices } from "../services/container.js";
import { buildApp } from "./app.js";

test("SSE stream sends a ready frame then broadcasts mutations", async () => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	const services = createServices(db, bus);
	const key = services.apiKeys.create("w", "write").raw;
	const app = buildApp({ bus, services });

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 4000);

	// Authenticate via the ?key= query param (the EventSource-friendly path).
	const res = await app.request(`/api/stream?key=${key}`, {
		signal: controller.signal,
	});
	assert.equal(res.status, 200);
	assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

	assert.ok(res.body);
	const reader = res.body.getReader();
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

	// The subscription is active now; a mutation should be broadcast.
	await app.request("/api/calendars", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({ name: "Work" }),
	});

	assert.equal(await nextEventName(), "calendar.created");

	controller.abort();
	clearTimeout(timer);
	await reader.cancel().catch(() => {});
});
