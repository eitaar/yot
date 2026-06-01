import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { openDb } from "./connection.js";

function columnNames(db: Database.Database, table: string): string[] {
	return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
		(c) => c.name,
	);
}

test("openDb adds columns missing from an older events table", () => {
	const dir = mkdtempSync(join(tmpdir(), "yot-mig-"));
	const file = join(dir, "old.db");
	const old = new Database(file);
	// An events table from before these columns existed.
	old.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT);`);
	old.close();

	const db = openDb(file);
	const cols = columnNames(db, "events");
	assert.ok(cols.includes("image_path"), "image_path added");
	assert.ok(cols.includes("url"), "url added");
	assert.ok(cols.includes("source_uid"), "source_uid added");
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("a fresh db has the new columns exactly once (migration is idempotent)", () => {
	const db = openDb(":memory:");
	const cols = columnNames(db, "events");
	assert.equal(cols.filter((c) => c === "url").length, 1);
	assert.ok(cols.includes("image_path"));
	db.close();
});
