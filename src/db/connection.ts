import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

export type DB = Database.Database;

/**
 * Open a database connection, set pragmas, apply the schema, then run any
 * idempotent column migrations.
 *
 * @param path - file path, or ":memory:" for an ephemeral DB (used in tests).
 */
export function openDb(path: string): DB {
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	// Migrate BEFORE applying the schema: adding any missing columns first means
	// new indexes in SCHEMA_SQL (e.g. on source_uid) never reference an absent
	// column on an older database. On a fresh DB the events table doesn't exist
	// yet, so migrate is a no-op and SCHEMA_SQL creates everything.
	migrate(db);
	db.exec(SCHEMA_SQL);
	return db;
}

/**
 * Add columns introduced after a DB was first created. `CREATE TABLE IF NOT
 * EXISTS` never alters an existing table, so older databases need this. Safe to
 * run on every boot.
 */
function migrate(db: DB): void {
	addColumnIfMissing(db, "events", "image_path", "TEXT");
	addColumnIfMissing(db, "events", "url", "TEXT");
	addColumnIfMissing(db, "events", "source_uid", "TEXT");
}

function addColumnIfMissing(
	db: DB,
	table: string,
	column: string,
	type: string,
): void {
	// table/column/type are internal constants here, never user input.
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
		name: string;
	}[];
	// If the table doesn't exist yet (fresh install), PRAGMA returns an empty
	// array. Skip — the column will be present once SCHEMA_SQL runs.
	if (cols.length === 0) return;
	if (cols.some((c) => c.name === column)) return;
	db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
