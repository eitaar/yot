import { NotFoundError, ValidationError } from "../core/errors.js";
import type { EventBus } from "../core/event-bus.js";
import { newId, now } from "../core/id.js";
import type { DB } from "../db/connection.js";
import type {
	CreateEventInput,
	CreateReminderInput,
	Event,
	EventQuery,
	Reminder,
	UpdateEventInput,
} from "../schemas/event.js";

/** Raw `events` row as stored (all_day is 0/1). */
type EventRow = {
	id: string;
	calendar_id: string;
	title: string;
	description: string | null;
	location: string | null;
	start_at: string;
	end_at: string;
	all_day: number;
	image_path: string | null;
	url: string | null;
	source_uid: string | null;
	created_at: string;
	updated_at: string;
};

/** Service-level create input: the public CreateEventInput plus an optional
 * source_uid that only the .ics import path supplies. */
export type CreateEventServiceInput = CreateEventInput & {
	source_uid?: string | null;
};

export class EventService {
	constructor(
		private readonly db: DB,
		private readonly bus: EventBus,
		private readonly images?: { remove(name: string): void },
	) {}

	create(input: CreateEventServiceInput): Event {
		this.assertCalendarExists(input.calendar_id);
		this.assertOrder(input.start_at, input.end_at);
		const ts = now();
		const row: EventRow = {
			id: newId(),
			calendar_id: input.calendar_id,
			title: input.title,
			description: input.description ?? null,
			location: input.location ?? null,
			start_at: input.start_at,
			end_at: input.end_at,
			all_day: input.all_day ? 1 : 0,
			image_path: input.image_path ?? null,
			url: input.url ?? null,
			source_uid: input.source_uid ?? null,
			created_at: ts,
			updated_at: ts,
		};
		this.db
			.prepare(
				`INSERT INTO events
				 (id, calendar_id, title, description, location, start_at, end_at, all_day, image_path, url, source_uid, created_at, updated_at)
				 VALUES
				 (@id, @calendar_id, @title, @description, @location, @start_at, @end_at, @all_day, @image_path, @url, @source_uid, @created_at, @updated_at)`,
			)
			.run(row);
		const ev = this.hydrate(row);
		this.bus.emit({ type: "event.created", data: ev });
		return ev;
	}

	get(id: string): Event {
		return this.hydrate(this.getRow(id));
	}

	list(q: EventQuery): Event[] {
		const clauses: string[] = [];
		const params: Record<string, unknown> = {
			limit: q.limit,
			offset: q.offset,
		};
		let join = "";
		if (q.calendarId) {
			clauses.push("e.calendar_id = @calendarId");
			params.calendarId = q.calendarId;
		}
		if (q.from) {
			clauses.push("e.start_at >= @from");
			params.from = q.from;
		}
		if (q.to) {
			clauses.push("e.start_at <= @to");
			params.to = q.to;
		}
		if (q.q) {
			clauses.push("(e.title LIKE @q OR e.description LIKE @q)");
			params.q = `%${q.q}%`;
		}
		if (q.tag) {
			join =
				"JOIN event_tags et ON et.event_id = e.id JOIN tags t ON t.id = et.tag_id";
			clauses.push("t.name = @tag");
			params.tag = q.tag;
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(
				`SELECT e.* FROM events e ${join} ${where} ORDER BY e.start_at LIMIT @limit OFFSET @offset`,
			)
			.all(params) as EventRow[];
		return this.hydrateMany(rows);
	}

	update(id: string, input: UpdateEventInput): Event {
		const current = this.getRow(id);
		const next: EventRow = {
			...current,
			calendar_id: input.calendar_id ?? current.calendar_id,
			title: input.title ?? current.title,
			description:
				input.description === undefined
					? current.description
					: input.description,
			location:
				input.location === undefined ? current.location : input.location,
			start_at: input.start_at ?? current.start_at,
			end_at: input.end_at ?? current.end_at,
			all_day:
				input.all_day === undefined ? current.all_day : input.all_day ? 1 : 0,
			image_path:
				input.image_path === undefined ? current.image_path : input.image_path,
			url: input.url === undefined ? current.url : input.url,
			updated_at: now(),
		};
		if (input.calendar_id) this.assertCalendarExists(input.calendar_id);
		this.assertOrder(next.start_at, next.end_at);
		this.db
			.prepare(
				`UPDATE events SET
				 calendar_id = @calendar_id, title = @title, description = @description, location = @location,
				 start_at = @start_at, end_at = @end_at, all_day = @all_day,
				 image_path = @image_path, url = @url, updated_at = @updated_at
				 WHERE id = @id`,
			)
			.run(next);
		// Remove the old file when the image is replaced or cleared to null.
		if (current.image_path && current.image_path !== next.image_path) {
			this.images?.remove(current.image_path);
		}
		const ev = this.hydrate(next);
		this.bus.emit({ type: "event.updated", data: ev });
		return ev;
	}

	delete(id: string): void {
		const row = this.getRow(id); // throws NotFoundError if absent
		this.db.prepare(`DELETE FROM events WHERE id = ?`).run(id);
		if (row.image_path) this.images?.remove(row.image_path);
		this.bus.emit({ type: "event.deleted", data: { id } });
	}

	addReminder(eventId: string, input: CreateReminderInput): Reminder {
		this.getRow(eventId); // assert event exists
		const reminder: Reminder = {
			id: newId(),
			event_id: eventId,
			minutes_before: input.minutes_before,
			method: input.method ?? "notification",
		};
		this.db
			.prepare(
				`INSERT INTO reminders (id, event_id, minutes_before, method)
				 VALUES (@id, @event_id, @minutes_before, @method)`,
			)
			.run(reminder);
		this.touchAndEmit(eventId);
		return reminder;
	}

	removeReminder(eventId: string, reminderId: string): void {
		const result = this.db
			.prepare(`DELETE FROM reminders WHERE id = ? AND event_id = ?`)
			.run(reminderId, eventId);
		if (result.changes === 0)
			throw new NotFoundError(`Reminder ${reminderId} not found`);
		this.touchAndEmit(eventId);
	}

	addTag(eventId: string, tagId: string): Event {
		this.getRow(eventId); // assert event exists
		const tag = this.db.prepare(`SELECT id FROM tags WHERE id = ?`).get(tagId);
		if (!tag) throw new NotFoundError(`Tag ${tagId} not found`);
		this.db
			.prepare(
				`INSERT OR IGNORE INTO event_tags (event_id, tag_id) VALUES (?, ?)`,
			)
			.run(eventId, tagId);
		return this.touchAndEmit(eventId);
	}

	removeTag(eventId: string, tagId: string): Event {
		this.getRow(eventId); // assert event exists
		this.db
			.prepare(`DELETE FROM event_tags WHERE event_id = ? AND tag_id = ?`)
			.run(eventId, tagId);
		return this.touchAndEmit(eventId);
	}

	existsBySourceUid(uid: string): boolean {
		return !!this.db
			.prepare(`SELECT 1 FROM events WHERE source_uid = ?`)
			.get(uid);
	}

	private getRow(id: string): EventRow {
		const row = this.db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as
			| EventRow
			| undefined;
		if (!row) throw new NotFoundError(`Event ${id} not found`);
		return row;
	}

	/** Bump updated_at, broadcast an event.updated, and return the fresh event. */
	private touchAndEmit(eventId: string): Event {
		this.db
			.prepare(`UPDATE events SET updated_at = ? WHERE id = ?`)
			.run(now(), eventId);
		const ev = this.hydrate(this.getRow(eventId));
		this.bus.emit({ type: "event.updated", data: ev });
		return ev;
	}

	/** Attach tag names and reminders to a raw row and convert all_day to boolean. */
	private hydrate(row: EventRow): Event {
		return this.hydrateMany([row])[0];
	}

	/**
	 * Hydrate many rows at once. Fetches every row's tags and reminders in two
	 * queries total (rather than two per row), avoiding the N+1 that `list()`
	 * would otherwise incur. Output order matches the input `rows` order.
	 */
	private hydrateMany(rows: EventRow[]): Event[] {
		if (rows.length === 0) return [];
		const ids = rows.map((r) => r.id);
		const placeholders = ids.map(() => "?").join(", ");

		const tagsByEvent = new Map<string, string[]>();
		const tagRows = this.db
			.prepare(
				`SELECT et.event_id AS event_id, t.name AS name
				 FROM tags t JOIN event_tags et ON et.tag_id = t.id
				 WHERE et.event_id IN (${placeholders}) ORDER BY t.name`,
			)
			.all(...ids) as { event_id: string; name: string }[];
		for (const { event_id, name } of tagRows) {
			const arr = tagsByEvent.get(event_id);
			if (arr) arr.push(name);
			else tagsByEvent.set(event_id, [name]);
		}

		const remindersByEvent = new Map<string, Reminder[]>();
		const reminderRows = this.db
			.prepare(
				`SELECT * FROM reminders WHERE event_id IN (${placeholders})
				 ORDER BY minutes_before DESC`,
			)
			.all(...ids) as Reminder[];
		for (const reminder of reminderRows) {
			const arr = remindersByEvent.get(reminder.event_id);
			if (arr) arr.push(reminder);
			else remindersByEvent.set(reminder.event_id, [reminder]);
		}

		return rows.map((row) => ({
			id: row.id,
			calendar_id: row.calendar_id,
			title: row.title,
			description: row.description,
			location: row.location,
			start_at: row.start_at,
			end_at: row.end_at,
			all_day: row.all_day === 1,
			image_path: row.image_path,
			url: row.url,
			source_uid: row.source_uid,
			created_at: row.created_at,
			updated_at: row.updated_at,
			tags: tagsByEvent.get(row.id) ?? [],
			reminders: remindersByEvent.get(row.id) ?? [],
		}));
	}

	private assertOrder(start: string, end: string): void {
		if (Date.parse(end) < Date.parse(start)) {
			throw new ValidationError(
				"end_at must be greater than or equal to start_at",
			);
		}
	}

	private assertCalendarExists(id: string): void {
		const cal = this.db
			.prepare(`SELECT id FROM calendars WHERE id = ?`)
			.get(id);
		if (!cal) throw new NotFoundError(`Calendar ${id} not found`);
	}
}
