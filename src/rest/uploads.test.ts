import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices, type Services } from "../services/container.js";
import { buildApp } from "./app.js";

let app: ReturnType<typeof buildApp>;
let services: Services;
let writeKey: string;
let imgDir: string;

beforeEach(() => {
	imgDir = mkdtempSync(join(tmpdir(), "yot-up-"));
	process.env.IMG_DIR = imgDir;
	const db = openDb(":memory:");
	const bus = new EventBus();
	services = createServices(db, bus);
	writeKey = services.apiKeys.create("w", "write").raw;
	app = buildApp({ bus, services });
});
afterEach(() => {
	delete process.env.IMG_DIR;
	rmSync(imgDir, { recursive: true, force: true });
});

test("uploads an image and serves it back", async () => {
	const form = new FormData();
	form.append(
		"file",
		new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "x.png", {
			type: "image/png",
		}),
	);
	const up = await app.request("/api/uploads/image", {
		method: "POST",
		headers: { authorization: `Bearer ${writeKey}` },
		body: form,
	});
	assert.equal(up.status, 201);
	const { path } = await up.json();
	assert.match(path, /^[0-9a-f-]{36}\.png$/);

	const got = await app.request(`/api/img/${path}`, {
		headers: { authorization: `Bearer ${writeKey}` },
	});
	assert.equal(got.status, 200);
	assert.equal(got.headers.get("content-type"), "image/png");
	assert.deepEqual(
		new Uint8Array(await got.arrayBuffer()),
		new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
	);
});

test("rejects a non-image upload with 400", async () => {
	const form = new FormData();
	form.append("file", new File(["hello"], "x.txt", { type: "text/plain" }));
	const res = await app.request("/api/uploads/image", {
		method: "POST",
		headers: { authorization: `Bearer ${writeKey}` },
		body: form,
	});
	assert.equal(res.status, 400);
});

test("image-from-url refuses a private address with 400", async () => {
	const res = await app.request("/api/uploads/image-from-url", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${writeKey}`,
		},
		body: JSON.stringify({ url: "http://127.0.0.1/x.png" }),
	});
	assert.equal(res.status, 400);
});

test("serving an unknown/unsafe name returns 404", async () => {
	const res = await app.request("/api/img/not-a-real-name", {
		headers: { authorization: `Bearer ${writeKey}` },
	});
	assert.equal(res.status, 404);
});
