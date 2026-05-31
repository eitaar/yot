import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices, type Services } from "../services/container.js";
import { buildApp } from "./app.js";

let app: ReturnType<typeof buildApp>;
let services: Services;
let writeKey: string;

async function mintPin(key: string, scope = "write") {
	const res = await app.request("/api/auth/pin", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			Authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({ scope }),
	});
	return res;
}

beforeEach(() => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	services = createServices(db, bus);
	writeKey = services.apiKeys.create("test", "write").raw;
	app = buildApp({ bus, services });
});

describe("auth pairing", () => {
	it("mints a pin and pairs into an HttpOnly session cookie", async () => {
		const { pin } = await (await mintPin(writeKey)).json();
		const pairRes = await app.request("/api/auth/pair", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pin }),
		});
		assert.equal(pairRes.status, 200);
		const setCookie = pairRes.headers.get("set-cookie") ?? "";
		assert.match(setCookie, /yot_session=/);
		assert.match(setCookie, /HttpOnly/i);
	});

	it("rejects an invalid pin", async () => {
		const res = await app.request("/api/auth/pair", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pin: "000000" }),
		});
		assert.equal(res.status, 401);
	});

	it("authenticates a later request using the session cookie", async () => {
		const { pin } = await (await mintPin(writeKey)).json();
		const pairRes = await app.request("/api/auth/pair", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pin }),
		});
		const cookie = (pairRes.headers.get("set-cookie") ?? "").split(";")[0];
		const calRes = await app.request("/api/calendars", {
			headers: { Cookie: cookie },
		});
		assert.equal(calRes.status, 200);
	});

	it("does not let a read key mint a write pin", async () => {
		const readKey = services.apiKeys.create("ro", "read").raw;
		const res = await mintPin(readKey, "write");
		assert.equal(res.status, 200);
		const { scope } = await res.json();
		assert.equal(scope, "read");
	});
});
