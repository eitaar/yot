import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { NotFoundError, ValidationError } from "../core/errors.js";
import { type ChangeEvent, EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { EventQuerySchema } from "../schemas/event.js";
import { CalendarService } from "./calendar.service.js";
import { EventService } from "./event.service.js";
import { TagService } from "./tag.service.js";

let events: EventService;
let calendars: CalendarService;
let tags: TagService;
let emitted: ChangeEvent[];
let calId: string;
let dbRef: ReturnType<typeof openDb>;
let busRef: EventBus;

function query(partial: Record<string, unknown> = {}) {
	return EventQuerySchema.parse(partial);
}

beforeEach(() => {
	dbRef = openDb(":memory:");
	busRef = new EventBus();
	emitted = [];
	busRef.subscribe((e) => emitted.push(e));
	calendars = new CalendarService(dbRef, busRef);
	tags = new TagService(dbRef, busRef);
	events = new EventService(dbRef, busRef);
	calId = calendars.create({ name: "Work" }).id;
	emitted.length = 0; // ignore the calendar.created emission
});

test("create persists an event with defaults and emits event.created", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "Sync",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});

	assert.ok(ev.id);
	assert.equal(ev.title, "Sync");
	assert.equal(ev.all_day, false);
	assert.deepEqual(ev.tags, []);
	assert.deepEqual(ev.reminders, []);
	assert.equal(emitted.at(-1)?.type, "event.created");
});

test("create rejects end_at before start_at with ValidationError", () => {
	assert.throws(
		() =>
			events.create({
				calendar_id: calId,
				title: "bad",
				start_at: "2026-05-29T11:00:00Z",
				end_at: "2026-05-29T10:00:00Z",
				all_day: false,
			}),
		ValidationError,
	);
});

test("create rejects an unknown calendar with NotFoundError", () => {
	assert.throws(
		() =>
			events.create({
				calendar_id: "missing",
				title: "x",
				start_at: "2026-05-29T10:00:00Z",
				end_at: "2026-05-29T11:00:00Z",
				all_day: false,
			}),
		NotFoundError,
	);
});

test("get returns the event; unknown id throws NotFoundError", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "X",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	assert.equal(events.get(ev.id).id, ev.id);
	assert.throws(() => events.get("nope"), NotFoundError);
});

test("update changes fields and emits event.updated", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "Old",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	const updated = events.update(ev.id, { title: "New" });
	assert.equal(updated.title, "New");
	assert.equal(emitted.at(-1)?.type, "event.updated");
});

test("update that would make end precede start throws ValidationError", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "X",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	assert.throws(
		() => events.update(ev.id, { end_at: "2026-05-29T09:00:00Z" }),
		ValidationError,
	);
});

test("delete removes the event and emits event.deleted", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "Temp",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	events.delete(ev.id);
	assert.throws(() => events.get(ev.id), NotFoundError);
	assert.equal(emitted.at(-1)?.type, "event.deleted");
	assert.throws(() => events.delete("nope"), NotFoundError);
});

test("reminders can be added and removed and appear on the event", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "X",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	const reminder = events.addReminder(ev.id, {
		minutes_before: 10,
		method: "notification",
	});
	assert.equal(events.get(ev.id).reminders.length, 1);
	assert.equal(emitted.at(-1)?.type, "event.updated");

	events.removeReminder(ev.id, reminder.id);
	assert.equal(events.get(ev.id).reminders.length, 0);
});

test("addReminder for an unknown event throws NotFoundError", () => {
	assert.throws(
		() =>
			events.addReminder("nope", { minutes_before: 5, method: "notification" }),
		NotFoundError,
	);
});

test("tags can be linked and unlinked by id and surface as names", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "X",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	const tag = tags.create({ name: "important" });

	events.addTag(ev.id, tag.id);
	assert.deepEqual(events.get(ev.id).tags, ["important"]);
	assert.equal(emitted.at(-1)?.type, "event.updated");

	events.removeTag(ev.id, tag.id);
	assert.deepEqual(events.get(ev.id).tags, []);
});

test("addTag throws NotFoundError for unknown event or tag", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "X",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	assert.throws(() => events.addTag("nope", "whatever"), NotFoundError);
	assert.throws(() => events.addTag(ev.id, "nope"), NotFoundError);
});

test("list filters by calendar, date range, tag, and search, with pagination", () => {
	const other = calendars.create({ name: "Personal" }).id;
	const tag = tags.create({ name: "vip" });

	const a = events.create({
		calendar_id: calId,
		title: "Alpha meeting",
		start_at: "2026-05-01T10:00:00Z",
		end_at: "2026-05-01T11:00:00Z",
		all_day: false,
	});
	events.create({
		calendar_id: calId,
		title: "Beta workshop",
		start_at: "2026-06-01T10:00:00Z",
		end_at: "2026-06-01T11:00:00Z",
		all_day: false,
	});
	events.create({
		calendar_id: other,
		title: "Gamma",
		start_at: "2026-05-15T10:00:00Z",
		end_at: "2026-05-15T11:00:00Z",
		all_day: false,
	});
	events.addTag(a.id, tag.id);

	assert.equal(events.list(query({ calendarId: calId })).length, 2);
	assert.equal(events.list(query({ from: "2026-05-20T00:00:00Z" })).length, 1); // only Beta
	assert.equal(events.list(query({ to: "2026-05-10T00:00:00Z" })).length, 1); // only Alpha
	assert.equal(events.list(query({ tag: "vip" })).length, 1);
	assert.equal(events.list(query({ q: "workshop" })).length, 1);
	assert.equal(events.list(query({ limit: 1 })).length, 1);
});

test("list hydrates each event's own tags and reminders, in start order", () => {
	const tagA = tags.create({ name: "aa" });
	const tagB = tags.create({ name: "bb" });

	const first = events.create({
		calendar_id: calId,
		title: "First",
		start_at: "2026-05-01T10:00:00Z",
		end_at: "2026-05-01T11:00:00Z",
		all_day: false,
	});
	const second = events.create({
		calendar_id: calId,
		title: "Second",
		start_at: "2026-05-02T10:00:00Z",
		end_at: "2026-05-02T11:00:00Z",
		all_day: false,
	});
	// Third event carries no tags or reminders — must hydrate to empty arrays.
	events.create({
		calendar_id: calId,
		title: "Third",
		start_at: "2026-05-03T10:00:00Z",
		end_at: "2026-05-03T11:00:00Z",
		all_day: false,
	});

	events.addTag(first.id, tagB.id);
	events.addTag(first.id, tagA.id);
	events.addTag(second.id, tagA.id);
	events.addReminder(first.id, { minutes_before: 10, method: "notification" });
	events.addReminder(first.id, { minutes_before: 60, method: "notification" });

	const list = events.list(query());
	assert.deepEqual(
		list.map((e) => e.title),
		["First", "Second", "Third"],
	);
	assert.deepEqual(list[0].tags, ["aa", "bb"]); // grouped to the right event, name-ordered
	assert.deepEqual(list[1].tags, ["aa"]);
	assert.deepEqual(list[2].tags, []);
	assert.deepEqual(
		list[0].reminders.map((r) => r.minutes_before),
		[60, 10], // minutes_before DESC
	);
	assert.deepEqual(list[1].reminders, []);
	assert.deepEqual(list[2].reminders, []);
});

test("create and get round-trip url and image_path; defaults are null", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "Rich",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
		url: "https://example.com",
		image_path: "11111111-1111-4111-8111-111111111111.png",
	});
	assert.equal(ev.url, "https://example.com");
	assert.equal(ev.image_path, "11111111-1111-4111-8111-111111111111.png");
	assert.equal(ev.source_uid, null);

	const plain = events.create({
		calendar_id: calId,
		title: "Plain",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	assert.equal(plain.url, null);
	assert.equal(plain.image_path, null);
});

test("update clears url with null and changes image_path", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "X",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
		url: "https://old.test",
	});
	const updated = events.update(ev.id, { url: null, image_path: "a.png" });
	assert.equal(updated.url, null);
	assert.equal(updated.image_path, "a.png");
});

test("existsBySourceUid reflects stored source_uid", () => {
	assert.equal(events.existsBySourceUid("uid-1"), false);
	events.create({
		calendar_id: calId,
		title: "Imported",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
		source_uid: "uid-1",
	});
	assert.equal(events.existsBySourceUid("uid-1"), true);
});

test("delete of an event with no image remover does not throw", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "WithImage",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
		image_path: "pic.png",
	});
	events.delete(ev.id);
	assert.throws(() => events.get(ev.id), NotFoundError);
});

test("delete calls the injected image remover with the stored image_path", () => {
	const removed: string[] = [];
	const ev = events.create({
		calendar_id: calId,
		title: "WithImage2",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
		image_path: "gone.png",
	});
	const spyBus = new EventBus();
	const spyEvents = new EventService(dbRef, spyBus, {
		remove: (n) => removed.push(n),
	});
	spyEvents.delete(ev.id);
	assert.deepEqual(removed, ["gone.png"]);
});

test("delete does not call the remover when the event has no image", () => {
	const removed: string[] = [];
	const ev = events.create({
		calendar_id: calId,
		title: "NoImage",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	const spyBus = new EventBus();
	const spyEvents = new EventService(dbRef, spyBus, {
		remove: (n) => removed.push(n),
	});
	spyEvents.delete(ev.id);
	assert.deepEqual(removed, []);
});
