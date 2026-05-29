import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { NotFoundError } from "../core/errors.js";
import { type ChangeEvent, EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { CalendarService } from "./calendar.service.js";

let svc: CalendarService;
let events: ChangeEvent[];

beforeEach(() => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	events = [];
	bus.subscribe((e) => events.push(e));
	svc = new CalendarService(db, bus);
});

test("create persists a calendar with id and timestamps, and emits calendar.created", () => {
	const cal = svc.create({ name: "Work", color: "#3b82f6" });

	assert.ok(cal.id);
	assert.equal(cal.name, "Work");
	assert.equal(cal.color, "#3b82f6");
	assert.ok(cal.created_at);
	assert.equal(cal.created_at, cal.updated_at);
	assert.deepEqual(events, [{ type: "calendar.created", data: cal }]);
});

test("get returns a previously created calendar", () => {
	const created = svc.create({ name: "Personal" });
	assert.deepEqual(svc.get(created.id), created);
});

test("get throws NotFoundError for an unknown id", () => {
	assert.throws(() => svc.get("nope"), NotFoundError);
});

test("list returns all calendars", () => {
	svc.create({ name: "A" });
	svc.create({ name: "B" });
	assert.equal(svc.list().length, 2);
});

test("update changes fields, bumps updated_at, and emits calendar.updated", () => {
	const cal = svc.create({ name: "Old" });
	const updated = svc.update(cal.id, { name: "New" });

	assert.equal(updated.name, "New");
	assert.equal(updated.id, cal.id);
	assert.equal(events.at(-1)?.type, "calendar.updated");
});

test("update throws NotFoundError for an unknown id", () => {
	assert.throws(() => svc.update("nope", { name: "x" }), NotFoundError);
});

test("delete removes the calendar and emits calendar.deleted", () => {
	const cal = svc.create({ name: "Temp" });
	svc.delete(cal.id);

	assert.throws(() => svc.get(cal.id), NotFoundError);
	assert.equal(events.at(-1)?.type, "calendar.deleted");
});

test("delete throws NotFoundError for an unknown id", () => {
	assert.throws(() => svc.delete("nope"), NotFoundError);
});
