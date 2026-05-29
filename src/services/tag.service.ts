import { ConflictError, NotFoundError } from "../core/errors.js";
import type { EventBus } from "../core/event-bus.js";
import { newId } from "../core/id.js";
import type { DB } from "../db/connection.js";
import type { CreateTagInput, Tag } from "../schemas/tag.js";

export class TagService {
	constructor(
		private readonly db: DB,
		private readonly bus: EventBus,
	) {}

	create(input: CreateTagInput): Tag {
		const tag: Tag = {
			id: newId(),
			name: input.name,
			color: input.color ?? null,
		};
		try {
			this.db
				.prepare(
					`INSERT INTO tags (id, name, color) VALUES (@id, @name, @color)`,
				)
				.run(tag);
		} catch (err) {
			if (err instanceof Error && /UNIQUE/.test(err.message)) {
				throw new ConflictError(`Tag "${input.name}" already exists`);
			}
			throw err;
		}
		this.bus.emit({ type: "tag.created", data: tag });
		return tag;
	}

	get(id: string): Tag {
		const row = this.db.prepare(`SELECT * FROM tags WHERE id = ?`).get(id) as
			| Tag
			| undefined;
		if (!row) throw new NotFoundError(`Tag ${id} not found`);
		return row;
	}

	list(): Tag[] {
		return this.db.prepare(`SELECT * FROM tags ORDER BY name`).all() as Tag[];
	}

	delete(id: string): void {
		const result = this.db.prepare(`DELETE FROM tags WHERE id = ?`).run(id);
		if (result.changes === 0) throw new NotFoundError(`Tag ${id} not found`);
		this.bus.emit({ type: "tag.deleted", data: { id } });
	}
}
