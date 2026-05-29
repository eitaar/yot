import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

export type DB = Database.Database;

/**
 * Open a database connection, set pragmas, and apply the schema.
 *
 * @param path - file path, or ":memory:" for an ephemeral DB (used in tests).
 */
export function openDb(path: string): DB {
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.exec(SCHEMA_SQL);
	return db;
}
