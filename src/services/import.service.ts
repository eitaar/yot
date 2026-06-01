import ICAL from "ical.js";
import { isHttpUrl } from "../schemas/common.js";
import type { EventService } from "./event.service.js";

export type ImportSummary = {
	created: number;
	skippedRecurring: number;
	skippedDuplicate: number;
	errors: string[];
};

/** Parses an iCalendar (.ics) string and creates one-off events from it. */
export class IcsImportService {
	constructor(private readonly events: EventService) {}

	importIcs(icsText: string, calendarId: string): ImportSummary {
		const summary: ImportSummary = {
			created: 0,
			skippedRecurring: 0,
			skippedDuplicate: 0,
			errors: [],
		};

		let vevents: ReturnType<ICAL.Component["getAllSubcomponents"]>;
		try {
			const comp = new ICAL.Component(ICAL.parse(icsText));
			vevents = comp.getAllSubcomponents("vevent");
		} catch (e) {
			summary.errors.push(
				`Could not parse .ics: ${e instanceof Error ? e.message : String(e)}`,
			);
			return summary;
		}

		for (const vevent of vevents) {
			try {
				// Recurrence is out of scope: skip anything with an RRULE.
				if (vevent.getFirstPropertyValue("rrule")) {
					summary.skippedRecurring++;
					continue;
				}
				const event = new ICAL.Event(vevent);
				const uid = event.uid || undefined;
				if (uid && this.events.existsBySourceUid(uid)) {
					summary.skippedDuplicate++;
					continue;
				}
				const start = event.startDate;
				if (!start) {
					summary.errors.push(
						`[${event.uid || "no-uid"}] VEVENT has no DTSTART; skipped`,
					);
					continue;
				}
				const end = event.endDate ?? start;
				const url = vevent.getFirstPropertyValue("url");
				const location = vevent.getFirstPropertyValue("location");
				// ical.js 2.x ships no timezone data: a DTSTART;TZID=... without an
				// inline VTIMEZONE is treated as floating and converted using the
				// server's local offset. Well-behaved exporters (Google/Apple) embed
				// VTIMEZONE, so this is correct for typical files.
				this.events.create({
					calendar_id: calendarId,
					title: event.summary || "(untitled)",
					description: event.description || undefined,
					location: typeof location === "string" ? location : undefined,
					url: typeof url === "string" && isHttpUrl(url) ? url : undefined,
					start_at: start.toJSDate().toISOString(),
					end_at: end.toJSDate().toISOString(),
					all_day: start.isDate,
					source_uid: uid ?? null,
				});
				summary.created++;
			} catch (e) {
				summary.errors.push(e instanceof Error ? e.message : String(e));
			}
		}
		return summary;
	}
}
