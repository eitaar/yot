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
	// An events table from before image_path / url / source_uid were added.
	old.exec(`
		CREATE TABLE calendars (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE events (
			id TEXT PRIMARY KEY,
			calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			description TEXT,
			location TEXT,
			start_at TEXT NOT NULL,
			end_at TEXT NOT NULL,
			all_day INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
		CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
	`);
	old.close();

	const db = openDb(file);
	const cols = columnNames(db, "events");
	assert.ok(cols.includes("image_path"), "image_path added");
	assert.ok(cols.includes("url"), "url added");
	assert.ok(cols.includes("source_uid"), "source_uid added");
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("re-opening the same db is idempotent (columns stay singular, no throw)", () => {
	const dir = mkdtempSync(join(tmpdir(), "yot-mig-idem-"));
	const file = join(dir, "db.db");
	openDb(file).close();
	const db = openDb(file); // second open must not throw or duplicate columns
	const cols = columnNames(db, "events");
	assert.equal(cols.filter((c) => c === "url").length, 1);
	assert.ok(cols.includes("image_path"));
	assert.ok(cols.includes("source_uid"));
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

test("openDb on a legacy db creates the source_uid index after migrating", () => {
	const dir = mkdtempSync(join(tmpdir(), "yot-mig-idx-"));
	const file = join(dir, "old.db");
	const old = new Database(file);
	// A realistic legacy DB: all original columns present, but the three new
	// ones (image_path, url, source_uid) and their indexes are absent.
	old.exec(`
		CREATE TABLE calendars (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE events (
			id TEXT PRIMARY KEY,
			calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			description TEXT,
			location TEXT,
			start_at TEXT NOT NULL,
			end_at TEXT NOT NULL,
			all_day INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
		CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
	`);
	old.close();

	const db = openDb(file);
	const indexes = (db.prepare("PRAGMA index_list(events)").all() as { name: string }[]).map(
		(i) => i.name,
	);
	assert.ok(indexes.includes("idx_events_source_uid"), "source_uid index created");
	db.close();
	rmSync(dir, { recursive: true, force: true });
});
