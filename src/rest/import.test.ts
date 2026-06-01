import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices, type Services } from "../services/container.js";
import { buildApp } from "./app.js";

let app: ReturnType<typeof buildApp>;
let services: Services;
let writeKey: string;

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//t//EN
BEGIN:VEVENT
UID:imp-1
SUMMARY:Imported one
DTSTART:20260602T140000Z
DTEND:20260602T150000Z
END:VEVENT
END:VCALENDAR`;

beforeEach(() => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	services = createServices(db, bus);
	writeKey = services.apiKeys.create("w", "write").raw;
	app = buildApp({ bus, services });
});

test("POST /events/import creates events and returns a summary", async () => {
	const cal = await (
		await app.request("/api/calendars", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${writeKey}`,
			},
			body: JSON.stringify({ name: "Cal" }),
		})
	).json();

	const form = new FormData();
	form.append("file", new File([ICS], "cal.ics", { type: "text/calendar" }));
	form.append("calendar_id", cal.id);

	const res = await app.request("/api/events/import", {
		method: "POST",
		headers: { authorization: `Bearer ${writeKey}` },
		body: form,
	});
	assert.equal(res.status, 200);
	const summary = await res.json();
	assert.equal(summary.created, 1);

	const list = await (
		await app.request(`/api/events?calendarId=${cal.id}`, {
			headers: { authorization: `Bearer ${writeKey}` },
		})
	).json();
	assert.equal(list.length, 1);
	assert.equal(list[0].title, "Imported one");
});

test("import to an unknown calendar returns 404", async () => {
	const form = new FormData();
	form.append("file", new File([ICS], "cal.ics", { type: "text/calendar" }));
	form.append("calendar_id", "does-not-exist");
	const res = await app.request("/api/events/import", {
		method: "POST",
		headers: { authorization: `Bearer ${writeKey}` },
		body: form,
	});
	assert.equal(res.status, 404);
});
