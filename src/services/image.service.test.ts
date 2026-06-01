import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { ValidationError } from "../core/errors.js";
import { ImageService, isPrivateHost } from "./image.service.js";

let dir: string;
let images: ImageService;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "yot-img-"));
	images = new ImageService(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("saveBytes writes a file and read round-trips it", () => {
	const name = images.saveBytes(new Uint8Array([1, 2, 3]), "image/png");
	assert.match(name, /^[0-9a-f-]{36}\.png$/);
	const { bytes, mime } = images.read(name);
	assert.equal(mime, "image/png");
	assert.deepEqual([...bytes], [1, 2, 3]);
});

test("saveBytes rejects unsupported mime and oversize", () => {
	assert.throws(() => images.saveBytes(new Uint8Array([0]), "text/plain"), ValidationError);
	const big = new Uint8Array(5 * 1024 * 1024 + 1);
	assert.throws(() => images.saveBytes(big, "image/png"), ValidationError);
});

test("assertSafeName rejects traversal and odd names", () => {
	assert.throws(() => images.absPath("../secret"), ValidationError);
	assert.throws(() => images.absPath("a/b.png"), ValidationError);
	assert.throws(() => images.absPath("evil.svg"), ValidationError);
});

test("exists is false for unsafe or missing names", () => {
	assert.equal(images.exists("../x"), false);
	assert.equal(images.exists("11111111-1111-4111-8111-111111111111.png"), false);
});

test("remove never throws for missing files", () => {
	images.remove("11111111-1111-4111-8111-111111111111.png");
	images.remove("nonsense");
});

test("isPrivateHost flags loopback/private and clears public", async () => {
	assert.equal(await isPrivateHost("localhost"), true);
	assert.equal(await isPrivateHost("127.0.0.1"), true);
	assert.equal(await isPrivateHost("10.1.2.3"), true);
	assert.equal(await isPrivateHost("192.168.0.5"), true);
	assert.equal(await isPrivateHost("172.16.4.4"), true);
	assert.equal(await isPrivateHost("::1"), true);
	assert.equal(await isPrivateHost("8.8.8.8"), false);
	assert.equal(await isPrivateHost("1.1.1.1"), false);
});

test("saveFromUrl rejects non-http and private hosts without network", async () => {
	await assert.rejects(() => images.saveFromUrl("ftp://example.com/x.png"), ValidationError);
	await assert.rejects(() => images.saveFromUrl("http://127.0.0.1/x.png"), ValidationError);
});
