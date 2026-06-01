import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { CalendarService } from "./calendar.service.js";
import { EventService } from "./event.service.js";
import { IcsImportService } from "./import.service.js";

let events: EventService;
let importer: IcsImportService;
let calId: string;

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:timed-1
SUMMARY:Timed meeting
DTSTART:20260602T140000Z
DTEND:20260602T150000Z
LOCATION:Room 4
URL:https://example.com/a
DESCRIPTION:Hello
END:VEVENT
BEGIN:VEVENT
UID:allday-1
SUMMARY:All day off
DTSTART;VALUE=DATE:20260605
DTEND;VALUE=DATE:20260606
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
SUMMARY:Standup
DTSTART:20260601T090000Z
DTEND:20260601T091500Z
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`;

beforeEach(() => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	const calendars = new CalendarService(db, bus);
	events = new EventService(db, bus);
	importer = new IcsImportService(events);
	calId = calendars.create({ name: "Imported" }).id;
});

test("imports one-off events, skips recurring, maps fields", () => {
	const s = importer.importIcs(ICS, calId);
	assert.equal(s.created, 2);
	assert.equal(s.skippedRecurring, 1);
	assert.equal(s.skippedDuplicate, 0);
	assert.deepEqual(s.errors, []);

	const list = events.list({ limit: 50, offset: 0 } as never);
	const timed = list.find((e) => e.title === "Timed meeting");
	assert.ok(timed);
	assert.equal(timed?.url, "https://example.com/a");
	assert.equal(timed?.location, "Room 4");
	assert.equal(timed?.all_day, false);
	assert.equal(timed?.source_uid, "timed-1");

	const allday = list.find((e) => e.title === "All day off");
	assert.equal(allday?.all_day, true);
});

test("re-importing the same file dedupes by UID", () => {
	importer.importIcs(ICS, calId);
	const s2 = importer.importIcs(ICS, calId);
	assert.equal(s2.created, 0);
	assert.equal(s2.skippedDuplicate, 2);
	assert.equal(s2.skippedRecurring, 1);
});
