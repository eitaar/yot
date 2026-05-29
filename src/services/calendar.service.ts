import { NotFoundError } from "../core/errors.js";
import type { EventBus } from "../core/event-bus.js";
import { newId, now } from "../core/id.js";
import type { DB } from "../db/connection.js";
import type {
	Calendar,
	CreateCalendarInput,
	UpdateCalendarInput,
} from "../schemas/calendar.js";

export class CalendarService {
	constructor(
		private readonly db: DB,
		private readonly bus: EventBus,
	) {}

	create(input: CreateCalendarInput): Calendar {
		const ts = now();
		const cal: Calendar = {
			id: newId(),
			name: input.name,
			color: input.color ?? null,
			description: input.description ?? null,
			created_at: ts,
			updated_at: ts,
		};
		this.db
			.prepare(
				`INSERT INTO calendars (id, name, color, description, created_at, updated_at)
				 VALUES (@id, @name, @color, @description, @created_at, @updated_at)`,
			)
			.run(cal);
		this.bus.emit({ type: "calendar.created", data: cal });
		return cal;
	}

	get(id: string): Calendar {
		const row = this.db
			.prepare(`SELECT * FROM calendars WHERE id = ?`)
			.get(id) as Calendar | undefined;
		if (!row) throw new NotFoundError(`Calendar ${id} not found`);
		return row;
	}

	list(): Calendar[] {
		return this.db
			.prepare(`SELECT * FROM calendars ORDER BY name`)
			.all() as Calendar[];
	}

	update(id: string, input: UpdateCalendarInput): Calendar {
		const current = this.get(id);
		const next: Calendar = {
			...current,
			name: input.name ?? current.name,
			color: input.color === undefined ? current.color : input.color,
			description:
				input.description === undefined
					? current.description
					: input.description,
			updated_at: now(),
		};
		this.db
			.prepare(
				`UPDATE calendars SET name = @name, color = @color, description = @description, updated_at = @updated_at
				 WHERE id = @id`,
			)
			.run(next);
		this.bus.emit({ type: "calendar.updated", data: next });
		return next;
	}

	delete(id: string): void {
		const result = this.db
			.prepare(`DELETE FROM calendars WHERE id = ?`)
			.run(id);
		if (result.changes === 0)
			throw new NotFoundError(`Calendar ${id} not found`);
		this.bus.emit({ type: "calendar.deleted", data: { id } });
	}
}
