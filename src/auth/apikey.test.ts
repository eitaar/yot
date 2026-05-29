import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { openDb } from "../db/connection.js";
import { ApiKeyService, hashKey } from "./apikey.js";

let svc: ApiKeyService;

beforeEach(() => {
	svc = new ApiKeyService(openDb(":memory:"));
});

test("hashKey is deterministic and input-specific", () => {
	assert.equal(hashKey("abc"), hashKey("abc"));
	assert.notEqual(hashKey("abc"), hashKey("abd"));
});

test("create returns a raw key with the cal_ prefix shown once", () => {
	const { raw, record } = svc.create("mobile", "write");
	assert.match(raw, /^cal_/);
	assert.equal(record.name, "mobile");
	assert.equal(record.scope, "write");
	assert.equal(record.revoked, false);
});

test("findByRawKey resolves the matching record and rejects unknown keys", () => {
	const { raw, record } = svc.create("cli", "read");
	const found = svc.findByRawKey(raw);
	assert.equal(found?.id, record.id);
	assert.equal(found?.scope, "read");
	assert.equal(svc.findByRawKey("cal_wrong"), null);
});

test("findByRawKey never exposes the key hash", () => {
	const { raw } = svc.create("x", "write");
	const found = svc.findByRawKey(raw) as Record<string, unknown>;
	assert.equal(found.key_hash, undefined);
});

test("a revoked key cannot be found", () => {
	const { raw, record } = svc.create("temp", "write");
	svc.revoke(record.id);
	assert.equal(svc.findByRawKey(raw), null);
});

test("touch records last_used_at", () => {
	const { raw, record } = svc.create("x", "write");
	assert.equal(svc.findByRawKey(raw)?.last_used_at, null);
	svc.touch(record.id);
	assert.ok(svc.findByRawKey(raw)?.last_used_at);
});
