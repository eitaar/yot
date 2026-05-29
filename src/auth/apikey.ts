import { createHash, randomBytes } from "node:crypto";
import { newId, now } from "../core/id.js";
import type { DB } from "../db/connection.js";

export type Scope = "read" | "write";

/** Public API-key metadata. The raw key and its hash are never included here. */
export type ApiKey = {
	id: string;
	name: string | null;
	scope: Scope;
	created_at: string;
	last_used_at: string | null;
	revoked: boolean;
};

/** Raw row shape (includes the hash and stores revoked as an integer). */
type ApiKeyRow = Omit<ApiKey, "revoked"> & {
	key_hash: string;
	revoked: number;
};

/** Generate a fresh opaque key. Shown to the user once; only its hash is stored. */
export function generateRawKey(): string {
	return `cal_${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 hex digest used as the at-rest representation of a key. */
export function hashKey(raw: string): string {
	return createHash("sha256").update(raw).digest("hex");
}

function toApiKey(row: ApiKeyRow): ApiKey {
	return {
		id: row.id,
		name: row.name,
		scope: row.scope,
		created_at: row.created_at,
		last_used_at: row.last_used_at,
		revoked: row.revoked === 1,
	};
}

export class ApiKeyService {
	constructor(private readonly db: DB) {}

	/** Create a key, store its hash, and return the raw key (shown once) + metadata. */
	create(name: string | null, scope: Scope): { raw: string; record: ApiKey } {
		const raw = generateRawKey();
		const record: ApiKey = {
			id: newId(),
			name,
			scope,
			created_at: now(),
			last_used_at: null,
			revoked: false,
		};
		this.db
			.prepare(
				`INSERT INTO api_keys (id, name, key_hash, scope, created_at, last_used_at, revoked)
				 VALUES (@id, @name, @key_hash, @scope, @created_at, NULL, 0)`,
			)
			.run({ ...record, key_hash: hashKey(raw) });
		return { raw, record };
	}

	/** Resolve a raw key to its (non-revoked) record, or null. */
	findByRawKey(raw: string): ApiKey | null {
		const row = this.db
			.prepare(`SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0`)
			.get(hashKey(raw)) as ApiKeyRow | undefined;
		return row ? toApiKey(row) : null;
	}

	list(): ApiKey[] {
		const rows = this.db
			.prepare(`SELECT * FROM api_keys ORDER BY created_at`)
			.all() as ApiKeyRow[];
		return rows.map(toApiKey);
	}

	touch(id: string): void {
		this.db
			.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`)
			.run(now(), id);
	}

	revoke(id: string): void {
		this.db.prepare(`UPDATE api_keys SET revoked = 1 WHERE id = ?`).run(id);
	}
}
