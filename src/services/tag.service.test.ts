import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { ConflictError, NotFoundError } from "../core/errors.js";
import { type ChangeEvent, EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { TagService } from "./tag.service.js";

let svc: TagService;
let events: ChangeEvent[];

beforeEach(() => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	events = [];
	bus.subscribe((e) => events.push(e));
	svc = new TagService(db, bus);
});

test("create persists a tag and emits tag.created", () => {
	const tag = svc.create({ name: "important", color: "#ef4444" });
	assert.ok(tag.id);
	assert.equal(tag.name, "important");
	assert.deepEqual(events, [{ type: "tag.created", data: tag }]);
});

test("create with a duplicate name throws ConflictError", () => {
	svc.create({ name: "dup" });
	assert.throws(() => svc.create({ name: "dup" }), ConflictError);
});

test("list returns all tags", () => {
	svc.create({ name: "a" });
	svc.create({ name: "b" });
	assert.equal(svc.list().length, 2);
});

test("delete removes the tag and emits tag.deleted", () => {
	const tag = svc.create({ name: "temp" });
	svc.delete(tag.id);
	assert.equal(svc.list().length, 0);
	assert.equal(events.at(-1)?.type, "tag.deleted");
});

test("delete throws NotFoundError for an unknown id", () => {
	assert.throws(() => svc.delete("nope"), NotFoundError);
});

test("update changes fields and emits tag.updated", () => {
	const tag = svc.create({ name: "old", color: "#ef4444" });
	events.length = 0;
	const updated = svc.update(tag.id, { name: "new", color: "#10b981" });
	assert.equal(updated.id, tag.id);
	assert.equal(updated.name, "new");
	assert.equal(updated.color, "#10b981");
	assert.deepEqual(events, [{ type: "tag.updated", data: updated }]);
	assert.equal(svc.get(tag.id).name, "new");
});

test("update with only a color keeps the name", () => {
	const tag = svc.create({ name: "keep", color: "#ef4444" });
	const updated = svc.update(tag.id, { color: "#3b82f6" });
	assert.equal(updated.name, "keep");
	assert.equal(updated.color, "#3b82f6");
});

test("update throws NotFoundError for an unknown id", () => {
	assert.throws(() => svc.update("nope", { name: "x" }), NotFoundError);
});

test("update to a duplicate name throws ConflictError", () => {
	svc.create({ name: "taken" });
	const other = svc.create({ name: "other" });
	assert.throws(() => svc.update(other.id, { name: "taken" }), ConflictError);
});
