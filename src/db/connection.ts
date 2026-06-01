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
	// Run column migrations before applying the full schema so that any new
	// indexes referencing the added columns don't fail on older databases.
	migrate(db);
	execSchema(db);
	return db;
}

/**
 * Apply SCHEMA_SQL statement by statement. `CREATE INDEX` statements are
 * executed best-effort: if an index references a column absent from a
 * pre-existing (legacy) table, we skip it — the index either already exists
 * or will be created after the next clean migration cycle. All `CREATE TABLE`
 * statements use `IF NOT EXISTS` and are always safe to run.
 */
function execSchema(db: DB): void {
	const statements = SCHEMA_SQL.split(";")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	for (const stmt of statements) {
		const isIndex = /^\s*CREATE\s+INDEX/i.test(stmt);
		try {
			db.exec(`${stmt};`);
		} catch (err) {
			// Swallow index-creation failures on legacy tables — those tables
			// already have the index (IF NOT EXISTS) or are missing the column
			// because they pre-date this schema version.
			if (!isIndex) throw err;
		}
	}
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
