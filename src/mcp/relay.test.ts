import assert from "node:assert/strict";
import { test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { startChangeRelay } from "./relay.js";

test("relay POSTs change events to the configured URL with auth header", async () => {
	const bus = new EventBus();
	const calls: { url: string; init: RequestInit }[] = [];

	const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: url as string, init: init! });
		return new Response(null, { status: 204 });
	};

	startChangeRelay(bus, {
		url: "http://localhost:4010/api/internal/events",
		apiKey: "cal_test123",
		fetchImpl: fakeFetch as typeof fetch,
	});

	bus.emit({ type: "event.created", data: { id: "e1", title: "Test" } });

	// Let the microtask (fire-and-forget fetch) settle.
	await new Promise((r) => setTimeout(r, 10));

	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "http://localhost:4010/api/internal/events");
	assert.equal(calls[0].init.method, "POST");

	const headers = calls[0].init.headers as Record<string, string>;
	assert.equal(headers.authorization, "Bearer cal_test123");
	assert.equal(headers["content-type"], "application/json");

	const body = JSON.parse(calls[0].init.body as string);
	assert.equal(body.type, "event.created");
	assert.deepEqual(body.data, { id: "e1", title: "Test" });
});

test("relay swallows fetch rejections without throwing", async () => {
	const bus = new EventBus();

	const failingFetch = async () => {
		throw new Error("network down");
	};

	startChangeRelay(bus, {
		url: "http://localhost:4010/api/internal/events",
		apiKey: "cal_test123",
		fetchImpl: failingFetch as typeof fetch,
	});

	// Should not throw.
	bus.emit({ type: "event.created", data: {} });
	await new Promise((r) => setTimeout(r, 10));
});

test("relay unsubscribe stops forwarding", async () => {
	const bus = new EventBus();
	const calls: unknown[] = [];

	const fakeFetch = async () => {
		calls.push(1);
		return new Response(null, { status: 204 });
	};

	const unsub = startChangeRelay(bus, {
		url: "http://localhost:4010/api/internal/events",
		apiKey: "cal_test123",
		fetchImpl: fakeFetch as typeof fetch,
	});

	bus.emit({ type: "event.created", data: {} });
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(calls.length, 1);

	unsub();
	bus.emit({ type: "event.updated", data: {} });
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(calls.length, 1);
});
