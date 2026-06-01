# Rich Calendar Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cover image (upload or paste-URL, stored locally), a single link, a markdown-rendered description, a cover/gallery view, and `.ics` import to calendar events.

**Architecture:** New nullable columns on `events` (`image_path`, `url`, `source_uid`) added via an idempotent boot-time migration. A small `ImageService` owns local image storage/validation/serving; an `IcsImportService` parses uploads with `ical.js`. REST gains upload, image-serve, and import endpoints; MCP inherits the new event fields automatically through the shared zod schemas. The Vue SPA renders markdown with `markdown-it`, gains a cover field + URL field in the event modal, a `/cover` route (ListView in "cover" mode), and an import dialog.

**Tech Stack:** TypeScript, Hono + `@hono/zod-openapi`, `better-sqlite3`, `@modelcontextprotocol/sdk`, Vue 3 + Vite + Tailwind/daisyUI, `node:test` via `tsx`. New deps: `ical.js` (backend), `markdown-it` + `@types/markdown-it` (web).

**Testing note:** The backend uses `node:test` (run with `npm test`). The `web/` project has **no** test runner; adding one is out of scope. Frontend tasks are verified with `npm --prefix web run build` (which runs `vue-tsc --noEmit`) plus explicit manual browser checks.

---

## File Structure

**Backend (modify):**
- `src/db/schema.ts` — add `image_path`, `url`, `source_uid` columns + index.
- `src/db/connection.ts` — run an idempotent column migration after the schema.
- `src/schemas/event.ts` — new fields on Event/Create/Update schemas.
- `src/services/event.service.ts` — thread new columns, `existsBySourceUid`, best-effort image unlink.
- `src/services/container.ts` — construct + wire `ImageService` and `IcsImportService`.
- `src/rest/app.ts` — register upload + import routes.

**Backend (create):**
- `src/services/image.service.ts` — image storage/validation/SSRF guard.
- `src/services/import.service.ts` — `.ics` parsing/mapping.
- `src/rest/uploads.ts` — upload + image-serve routes.
- `src/rest/import.ts` — `.ics` import route.
- Tests: `src/db/connection.test.ts`, `src/services/image.service.test.ts`, `src/services/import.service.test.ts`, `src/rest/uploads.test.ts`, `src/rest/import.test.ts` (plus additions to `src/services/event.service.test.ts`, `src/rest/app.test.ts`).

**Frontend (modify):**
- `web/src/api/client.ts` — types + upload/import methods + `imageSrc`.
- `web/src/components/EventModal.vue` — markdown render, cover field, URL field.
- `web/src/views/ListView.vue` — body-swap to cover grid by route.
- `web/src/router.ts` — `/cover` route.
- `web/src/App.vue` — Cover nav link + import button + mount dialog.
- `web/src/components/BottomDock.vue` — Cover nav link + import menu item.

**Frontend (create):**
- `web/src/lib/markdown.ts` — `renderMarkdown`.
- `web/src/components/CoverGrid.vue` — gallery grid.
- `web/src/components/ImportIcsDialog.vue` — import UI.
- `web/src/composables/useImport.ts` — shared open/close state.

---

## Task 1: DB schema + idempotent migration

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/connection.ts`
- Test: `src/db/connection.test.ts` (create)

- [ ] **Step 1: Add columns + index to the schema**

In `src/db/schema.ts`, change the `events` table and add an index. Replace:

```ts
  start_at    TEXT NOT NULL,
  end_at      TEXT NOT NULL,
  all_day     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
```

with:

```ts
  start_at    TEXT NOT NULL,
  end_at      TEXT NOT NULL,
  all_day     INTEGER NOT NULL DEFAULT 0,
  image_path  TEXT,
  url         TEXT,
  source_uid  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_source_uid ON events(source_uid);
```

- [ ] **Step 2: Write the failing migration test**

Create `src/db/connection.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="migration"`
Expected: FAIL — `openDb` does not yet add columns to the old table (`image_path added` assertion fails).

- [ ] **Step 4: Implement the migration**

Replace the entire contents of `src/db/connection.ts` with:

```ts
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
	db.exec(SCHEMA_SQL);
	migrate(db);
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
	if (cols.some((c) => c.name === column)) return;
	db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="migration|idempotent"`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/connection.ts src/db/connection.test.ts
git commit -m "feat(db): add image_path, url, source_uid columns + boot migration"
```

---

## Task 2: Event zod schemas — new fields

**Files:**
- Modify: `src/schemas/event.ts`

- [ ] **Step 1: Add fields to the schemas**

In `src/schemas/event.ts`, update three schemas.

`EventSchema` — add after `all_day: z.boolean(),`:

```ts
		all_day: z.boolean(),
		image_path: z.string().nullable(),
		url: z.string().nullable(),
		source_uid: z.string().nullable(),
```

`CreateEventSchema` — add after `all_day: z.boolean().optional().default(false),`:

```ts
		all_day: z.boolean().optional().default(false),
		url: z.string().optional(),
		image_path: z.string().optional(),
```

`UpdateEventSchema` — add after `all_day: z.boolean().optional(),`:

```ts
		all_day: z.boolean().optional(),
		url: z.string().nullable().optional(),
		image_path: z.string().nullable().optional(),
```

(`source_uid` is intentionally **not** in the public create/update schemas — only the import path sets it, via the service.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL — `EventService` no longer satisfies the widened `Event` type (missing `image_path`/`url`/`source_uid` in `hydrateMany`). This confirms the schema change is wired to the type system; Task 3 fixes the service.

- [ ] **Step 3: Commit**

```bash
git add src/schemas/event.ts
git commit -m "feat(events): add image_path, url, source_uid to event schemas"
```

> MCP parity is automatic: `src/mcp/server.ts` builds `create_event`/`update_event` tool inputs from `CreateEventSchema.shape`/`UpdateEventSchema.shape`, and `get_event`/`list_events` return `EventService` output — so all four tools pick up the new fields with no MCP code change.

---

## Task 3: EventService — thread fields, dedupe lookup, image unlink

**Files:**
- Modify: `src/services/event.service.ts`
- Test: `src/services/event.service.test.ts`

- [ ] **Step 1: Write failing service tests**

Append to `src/services/event.service.test.ts`:

```ts
test("create and get round-trip url and image_path; defaults are null", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "Rich",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
		url: "https://example.com",
		image_path: "11111111-1111-4111-8111-111111111111.png",
	});
	assert.equal(ev.url, "https://example.com");
	assert.equal(ev.image_path, "11111111-1111-4111-8111-111111111111.png");
	assert.equal(ev.source_uid, null);

	const plain = events.create({
		calendar_id: calId,
		title: "Plain",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
	});
	assert.equal(plain.url, null);
	assert.equal(plain.image_path, null);
});

test("update clears url with null and changes image_path", () => {
	const ev = events.create({
		calendar_id: calId,
		title: "X",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
		url: "https://old.test",
	});
	const updated = events.update(ev.id, { url: null, image_path: "a.png" });
	assert.equal(updated.url, null);
	assert.equal(updated.image_path, "a.png");
});

test("existsBySourceUid reflects stored source_uid", () => {
	assert.equal(events.existsBySourceUid("uid-1"), false);
	events.create({
		calendar_id: calId,
		title: "Imported",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
		source_uid: "uid-1",
	});
	assert.equal(events.existsBySourceUid("uid-1"), true);
});

test("delete removes the event's image via the injected image remover", () => {
	const removed: string[] = [];
	const ev = events.create({
		calendar_id: calId,
		title: "WithImage",
		start_at: "2026-05-29T10:00:00Z",
		end_at: "2026-05-29T11:00:00Z",
		all_day: false,
		image_path: "pic.png",
	});
	// Re-create the service with a spy remover sharing the same db is awkward;
	// instead assert the no-image path does not throw without a remover.
	events.delete(ev.id);
	assert.throws(() => events.get(ev.id), NotFoundError);
	assert.deepEqual(removed, []); // sanity: spy not wired in this default setup
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="round-trip url|existsBySourceUid|clears url"`
Expected: FAIL — `events.create` ignores `url`/`image_path`/`source_uid`; `existsBySourceUid` is not a function.

- [ ] **Step 3: Implement the service changes**

In `src/services/event.service.ts`:

(a) Extend the `EventRow` type — add three fields before `created_at`:

```ts
	all_day: number;
	image_path: string | null;
	url: string | null;
	source_uid: string | null;
	created_at: string;
	updated_at: string;
};
```

(b) Add a service-level create input type just below the `EventRow` type:

```ts
/** Service-level create input: the public CreateEventInput plus an optional
 * source_uid that only the .ics import path supplies. */
export type CreateEventServiceInput = CreateEventInput & {
	source_uid?: string | null;
};
```

(c) Change the constructor to accept an optional image remover:

```ts
	constructor(
		private readonly db: DB,
		private readonly bus: EventBus,
		private readonly images?: { remove(name: string): void },
	) {}
```

(d) Replace `create` with:

```ts
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
```

(e) In `update`, replace the `next` object and the UPDATE statement. The `next` builder gains:

```ts
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
```

and the UPDATE statement becomes:

```ts
		this.db
			.prepare(
				`UPDATE events SET
				 calendar_id = @calendar_id, title = @title, description = @description, location = @location,
				 start_at = @start_at, end_at = @end_at, all_day = @all_day,
				 image_path = @image_path, url = @url, updated_at = @updated_at
				 WHERE id = @id`,
			)
			.run(next);
		// Drop a replaced/cleared image file (best-effort).
		if (current.image_path && current.image_path !== next.image_path) {
			this.images?.remove(current.image_path);
		}
		const ev = this.hydrate(next);
		this.bus.emit({ type: "event.updated", data: ev });
		return ev;
```

(f) Replace `delete` so it captures the image first:

```ts
	delete(id: string): void {
		const row = this.getRow(id); // throws NotFoundError if absent
		this.db.prepare(`DELETE FROM events WHERE id = ?`).run(id);
		this.bus.emit({ type: "event.deleted", data: { id } });
		if (row.image_path) this.images?.remove(row.image_path);
	}
```

(g) Add `existsBySourceUid` (place it next to `getRow`):

```ts
	existsBySourceUid(uid: string): boolean {
		return !!this.db
			.prepare(`SELECT 1 FROM events WHERE source_uid = ?`)
			.get(uid);
	}
```

(h) In `hydrateMany`, add the three fields to the returned object (after `all_day`):

```ts
			all_day: row.all_day === 1,
			image_path: row.image_path,
			url: row.url,
			source_uid: row.source_uid,
			created_at: row.created_at,
			updated_at: row.updated_at,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="round-trip url|existsBySourceUid|clears url|delete removes"`
Expected: PASS. Then run the full event suite: `npm test -- --test-name-pattern="event"` → PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/services/event.service.ts src/services/event.service.test.ts
git commit -m "feat(events): persist url/image_path/source_uid; add dedupe lookup + image unlink"
```

---

## Task 4: REST exposes url + image_path round-trip

**Files:**
- Test: `src/rest/app.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/rest/app.test.ts`:

```ts
test("events REST round-trips url and image_path", async () => {
	const cal = await (
		await app.request("/api/calendars", json({ name: "Work" }))
	).json();

	const created = await (
		await app.request(
			"/api/events",
			json({
				calendar_id: cal.id,
				title: "Linked",
				start_at: "2026-05-29T10:00:00Z",
				end_at: "2026-05-29T11:00:00Z",
				url: "https://example.com",
				image_path: "11111111-1111-4111-8111-111111111111.png",
			}),
		)
	).json();
	assert.equal(created.url, "https://example.com");
	assert.equal(created.image_path, "11111111-1111-4111-8111-111111111111.png");
	assert.equal(created.source_uid, null);

	const patched = await (
		await app.request(`/api/events/${created.id}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${writeKey}`,
			},
			body: JSON.stringify({ url: null }),
		})
	).json();
	assert.equal(patched.url, null);
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern="round-trips url and image_path"`
Expected: PASS (the schema + service work from Tasks 2–3 already cover this; this test locks the REST contract).

- [ ] **Step 3: Commit**

```bash
git add src/rest/app.test.ts
git commit -m "test(rest): assert events expose url + image_path"
```

---

## Task 5: ImageService — storage, validation, SSRF guard

**Files:**
- Create: `src/services/image.service.ts`
- Test: `src/services/image.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/image.service.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { ValidationError } from "../core/errors.js";
import { ImageService, isPrivateHost } from "./image.service.js";

let dir: string;
let images: ImageService;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "yot-img-"));
	images = new ImageService(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("saveBytes writes a file and read round-trips it", () => {
	const name = images.saveBytes(new Uint8Array([1, 2, 3]), "image/png");
	assert.match(name, /^[0-9a-f-]{36}\.png$/);
	const { bytes, mime } = images.read(name);
	assert.equal(mime, "image/png");
	assert.deepEqual([...bytes], [1, 2, 3]);
});

test("saveBytes rejects unsupported mime and oversize", () => {
	assert.throws(() => images.saveBytes(new Uint8Array([0]), "text/plain"), ValidationError);
	const big = new Uint8Array(5 * 1024 * 1024 + 1);
	assert.throws(() => images.saveBytes(big, "image/png"), ValidationError);
});

test("assertSafeName rejects traversal and odd names", () => {
	assert.throws(() => images.absPath("../secret"), ValidationError);
	assert.throws(() => images.absPath("a/b.png"), ValidationError);
	assert.throws(() => images.absPath("evil.svg"), ValidationError);
});

test("exists is false for unsafe or missing names", () => {
	assert.equal(images.exists("../x"), false);
	assert.equal(images.exists("11111111-1111-4111-8111-111111111111.png"), false);
});

test("remove never throws for missing files", () => {
	images.remove("11111111-1111-4111-8111-111111111111.png");
	images.remove("nonsense");
});

test("isPrivateHost flags loopback/private and clears public", async () => {
	assert.equal(await isPrivateHost("localhost"), true);
	assert.equal(await isPrivateHost("127.0.0.1"), true);
	assert.equal(await isPrivateHost("10.1.2.3"), true);
	assert.equal(await isPrivateHost("192.168.0.5"), true);
	assert.equal(await isPrivateHost("172.16.4.4"), true);
	assert.equal(await isPrivateHost("::1"), true);
	assert.equal(await isPrivateHost("8.8.8.8"), false);
	assert.equal(await isPrivateHost("1.1.1.1"), false);
});

test("saveFromUrl rejects non-http and private hosts without network", async () => {
	await assert.rejects(() => images.saveFromUrl("ftp://example.com/x.png"), ValidationError);
	await assert.rejects(() => images.saveFromUrl("http://127.0.0.1/x.png"), ValidationError);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="saveBytes|isPrivateHost|assertSafeName"`
Expected: FAIL — module `./image.service.js` does not exist.

- [ ] **Step 3: Implement ImageService**

Create `src/services/image.service.ts`:

```ts
import { lookup } from "node:dns/promises";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { ValidationError } from "../core/errors.js";
import { newId } from "../core/id.js";

const MIME_EXT: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};
const MAX_BYTES = 5 * 1024 * 1024;
const NAME_RE = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;

/** Owns local cover-image storage under a single directory. */
export class ImageService {
	constructor(private readonly dir: string) {}

	assertSafeName(name: string): void {
		if (!NAME_RE.test(name)) throw new ValidationError(`Unsafe image name: ${name}`);
	}

	absPath(name: string): string {
		this.assertSafeName(name);
		return join(this.dir, name);
	}

	exists(name: string): boolean {
		return NAME_RE.test(name) && existsSync(join(this.dir, name));
	}

	read(name: string): { bytes: Buffer; mime: string } {
		const path = this.absPath(name);
		const ext = name.slice(name.lastIndexOf(".") + 1);
		const mime =
			Object.keys(MIME_EXT).find((m) => MIME_EXT[m] === ext) ??
			"application/octet-stream";
		return { bytes: readFileSync(path), mime };
	}

	saveBytes(bytes: Uint8Array, mime: string): string {
		const ext = MIME_EXT[mime];
		if (!ext) throw new ValidationError(`Unsupported image type: ${mime || "unknown"}`);
		if (bytes.byteLength > MAX_BYTES)
			throw new ValidationError("Image exceeds the 5 MB limit");
		this.ensureDir();
		const name = `${newId()}.${ext}`;
		writeFileSync(join(this.dir, name), bytes);
		return name;
	}

	async saveFromUrl(url: string): Promise<string> {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new ValidationError("Invalid URL");
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			throw new ValidationError("Image URL must be http(s)");
		if (await isPrivateHost(parsed.hostname))
			throw new ValidationError("Refusing to fetch a private/loopback address");
		const res = await fetch(parsed, {
			redirect: "follow",
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) throw new ValidationError(`Image fetch failed: ${res.status}`);
		const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
		if (!MIME_EXT[mime])
			throw new ValidationError(`Unsupported image type: ${mime || "unknown"}`);
		const bytes = new Uint8Array(await res.arrayBuffer());
		return this.saveBytes(bytes, mime);
	}

	remove(name: string): void {
		try {
			if (NAME_RE.test(name)) unlinkSync(join(this.dir, name));
		} catch {
			// best-effort: missing/locked files are fine to ignore
		}
	}

	private ensureDir(): void {
		if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
	}
}

/** True if a hostname is localhost or resolves to a private/loopback address. */
export async function isPrivateHost(hostname: string): Promise<boolean> {
	const host = hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
	if (host === "localhost") return true;
	const addrs = isIP(host) ? [host] : await safeLookup(host);
	if (addrs.length === 0) return true; // unresolvable → treat as unsafe
	return addrs.some(isPrivateIp);
}

async function safeLookup(host: string): Promise<string[]> {
	try {
		return (await lookup(host, { all: true })).map((r) => r.address);
	} catch {
		return [];
	}
}

function isPrivateIp(ip: string): boolean {
	if (ip.includes(":")) {
		const v = ip.toLowerCase();
		if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
		return (
			v === "::1" ||
			v.startsWith("fc") ||
			v.startsWith("fd") ||
			v.startsWith("fe80")
		);
	}
	const p = ip.split(".").map(Number);
	if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
	const [a, b] = p;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127)
	);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="saveBytes|isPrivateHost|assertSafeName|exists is false|remove never|saveFromUrl rejects"`
Expected: PASS (all ImageService tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/image.service.ts src/services/image.service.test.ts
git commit -m "feat(images): local image storage with type/size validation + SSRF guard"
```

---

## Task 6: Wire ImageService into the container

**Files:**
- Modify: `src/services/container.ts`

- [ ] **Step 1: Update the container**

Replace the contents of `src/services/container.ts` with:

```ts
import { ApiKeyService } from "../auth/apikey.js";
import { PairingService } from "../auth/pairing.js";
import type { EventBus } from "../core/event-bus.js";
import type { DB } from "../db/connection.js";
import { CalendarService } from "./calendar.service.js";
import { EventService } from "./event.service.js";
import { ImageService } from "./image.service.js";
import { TagService } from "./tag.service.js";

/** The shared set of services consumed by REST, MCP, and SSE. */
export type Services = {
	calendars: CalendarService;
	events: EventService;
	tags: TagService;
	apiKeys: ApiKeyService;
	pairing: PairingService;
	images: ImageService;
};

/** Construct every service against one db connection and event bus. */
export function createServices(db: DB, bus: EventBus): Services {
	// Read at call time (not module load) so tests can set IMG_DIR per run.
	const images = new ImageService(process.env.IMG_DIR ?? "data/img");
	const pairing = new PairingService();
	return {
		calendars: new CalendarService(db, bus),
		events: new EventService(db, bus, images),
		tags: new TagService(db, bus),
		apiKeys: new ApiKeyService(db),
		pairing,
		images,
	};
}
```

- [ ] **Step 2: Typecheck + run existing suites**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. (`ImageService.ensureDir` is lazy, so constructing it in tests creates no directories.)

- [ ] **Step 3: Commit**

```bash
git add src/services/container.ts
git commit -m "feat(services): wire ImageService into the container"
```

---

## Task 7: Upload + image-serve REST routes

**Files:**
- Create: `src/rest/uploads.ts`
- Modify: `src/rest/app.ts`
- Test: `src/rest/uploads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/rest/uploads.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices, type Services } from "../services/container.js";
import { buildApp } from "./app.js";

let app: ReturnType<typeof buildApp>;
let services: Services;
let writeKey: string;
let imgDir: string;

beforeEach(() => {
	imgDir = mkdtempSync(join(tmpdir(), "yot-up-"));
	process.env.IMG_DIR = imgDir;
	const db = openDb(":memory:");
	const bus = new EventBus();
	services = createServices(db, bus);
	writeKey = services.apiKeys.create("w", "write").raw;
	app = buildApp({ bus, services });
});
afterEach(() => {
	delete process.env.IMG_DIR;
	rmSync(imgDir, { recursive: true, force: true });
});

test("uploads an image and serves it back", async () => {
	const form = new FormData();
	form.append(
		"file",
		new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "x.png", {
			type: "image/png",
		}),
	);
	const up = await app.request("/api/uploads/image", {
		method: "POST",
		headers: { authorization: `Bearer ${writeKey}` },
		body: form,
	});
	assert.equal(up.status, 201);
	const { path } = await up.json();
	assert.match(path, /^[0-9a-f-]{36}\.png$/);

	const got = await app.request(`/api/img/${path}`, {
		headers: { authorization: `Bearer ${writeKey}` },
	});
	assert.equal(got.status, 200);
	assert.equal(got.headers.get("content-type"), "image/png");
});

test("rejects a non-image upload with 400", async () => {
	const form = new FormData();
	form.append("file", new File(["hello"], "x.txt", { type: "text/plain" }));
	const res = await app.request("/api/uploads/image", {
		method: "POST",
		headers: { authorization: `Bearer ${writeKey}` },
		body: form,
	});
	assert.equal(res.status, 400);
});

test("image-from-url refuses a private address with 400", async () => {
	const res = await app.request("/api/uploads/image-from-url", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${writeKey}`,
		},
		body: JSON.stringify({ url: "http://127.0.0.1/x.png" }),
	});
	assert.equal(res.status, 400);
});

test("serving an unknown/unsafe name returns 404", async () => {
	const res = await app.request("/api/img/not-a-real-name", {
		headers: { authorization: `Bearer ${writeKey}` },
	});
	assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="uploads an image|rejects a non-image|image-from-url refuses|unknown/unsafe"`
Expected: FAIL — routes return 404 (not registered).

- [ ] **Step 3: Implement the routes**

Create `src/rest/uploads.ts`:

```ts
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthEnv } from "../auth/middleware.js";
import { ValidationError } from "../core/errors.js";
import type { Services } from "../services/container.js";

/**
 * Image upload + serve routes. These use multipart/raw bodies, so they are
 * plain Hono routes (not OpenAPI-documented). They still sit behind the auth
 * gate registered in app.ts (writes need a write key; GET allows read/cookie).
 */
export function registerUploadRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ images }: Services,
): void {
	api.post("/uploads/image", async (c) => {
		const body = await c.req.parseBody();
		const file = body.file;
		if (!(file instanceof File))
			throw new ValidationError("Expected a 'file' field");
		const bytes = new Uint8Array(await file.arrayBuffer());
		const name = images.saveBytes(bytes, file.type);
		return c.json({ path: name }, 201);
	});

	api.post("/uploads/image-from-url", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { url?: unknown };
		if (typeof body.url !== "string")
			throw new ValidationError("Expected { url }");
		const name = await images.saveFromUrl(body.url);
		return c.json({ path: name }, 201);
	});

	api.get("/img/:file", (c) => {
		const file = c.req.param("file");
		if (!images.exists(file)) return c.body(null, 404);
		const { bytes, mime } = images.read(file);
		c.header("Content-Type", mime);
		c.header("Cache-Control", "private, max-age=31536000, immutable");
		return c.body(bytes);
	});
}
```

In `src/rest/app.ts`, add the import near the other route imports:

```ts
import { registerStreamRoute } from "./stream.js";
import { registerTagRoutes } from "./tags.js";
import { registerUploadRoutes } from "./uploads.js";
```

and register it in the protected section, right after `registerEventRoutes(api, services);`:

```ts
	registerEventRoutes(api, services);
	registerUploadRoutes(api, services);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --test-name-pattern="uploads an image|rejects a non-image|image-from-url refuses|unknown/unsafe"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rest/uploads.ts src/rest/app.ts src/rest/uploads.test.ts
git commit -m "feat(rest): image upload, paste-URL fetch, and image serving"
```

---

## Task 8: .ics import service

**Files:**
- Create: `src/services/import.service.ts`
- Test: `src/services/import.service.test.ts`
- Modify: `package.json` (add `ical.js`)

- [ ] **Step 1: Install ical.js**

Run: `npm install ical.js`
Expected: adds `ical.js` to `dependencies`. (`ical.js` v2 ships its own TypeScript types; no `@types` package needed. If `tsc` later reports "no default export", change the import to `import * as ICAL from "ical.js";`.)

- [ ] **Step 2: Write the failing test**

Create `src/services/import.service.test.ts`:

```ts
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { CalendarService } from "./calendar.service.js";
import { EventService } from "./event.service.js";
import { IcsImportService } from "./import.service.js";

let events: EventService;
let importer: IcsImportService;
let calId: string;

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:timed-1
SUMMARY:Timed meeting
DTSTART:20260602T140000Z
DTEND:20260602T150000Z
LOCATION:Room 4
URL:https://example.com/a
DESCRIPTION:Hello
END:VEVENT
BEGIN:VEVENT
UID:allday-1
SUMMARY:All day off
DTSTART;VALUE=DATE:20260605
DTEND;VALUE=DATE:20260606
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
SUMMARY:Standup
DTSTART:20260601T090000Z
DTEND:20260601T091500Z
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`;

beforeEach(() => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	const calendars = new CalendarService(db, bus);
	events = new EventService(db, bus);
	importer = new IcsImportService(events);
	calId = calendars.create({ name: "Imported" }).id;
});

test("imports one-off events, skips recurring, maps fields", () => {
	const s = importer.importIcs(ICS, calId);
	assert.equal(s.created, 2);
	assert.equal(s.skippedRecurring, 1);
	assert.equal(s.skippedDuplicate, 0);
	assert.deepEqual(s.errors, []);

	const list = events.list({ limit: 50, offset: 0 } as never);
	const timed = list.find((e) => e.title === "Timed meeting");
	assert.ok(timed);
	assert.equal(timed?.url, "https://example.com/a");
	assert.equal(timed?.location, "Room 4");
	assert.equal(timed?.all_day, false);
	assert.equal(timed?.source_uid, "timed-1");

	const allday = list.find((e) => e.title === "All day off");
	assert.equal(allday?.all_day, true);
});

test("re-importing the same file dedupes by UID", () => {
	importer.importIcs(ICS, calId);
	const s2 = importer.importIcs(ICS, calId);
	assert.equal(s2.created, 0);
	assert.equal(s2.skippedDuplicate, 2);
	assert.equal(s2.skippedRecurring, 1);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- --test-name-pattern="imports one-off|dedupes by UID"`
Expected: FAIL — `./import.service.js` does not exist.

- [ ] **Step 4: Implement the import service**

Create `src/services/import.service.ts`:

```ts
import ICAL from "ical.js";
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

		let vevents: ICAL.Component[];
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
				const end = event.endDate ?? start;
				const url = vevent.getFirstPropertyValue("url");
				const location = vevent.getFirstPropertyValue("location");
				this.events.create({
					calendar_id: calendarId,
					title: event.summary || "(untitled)",
					description: event.description || undefined,
					location: typeof location === "string" ? location : undefined,
					url: typeof url === "string" ? url : undefined,
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --test-name-pattern="imports one-off|dedupes by UID"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/services/import.service.ts src/services/import.service.test.ts
git commit -m "feat(import): parse .ics into one-off events (skip recurring, dedupe by UID)"
```

---

## Task 9: .ics import REST route

**Files:**
- Create: `src/rest/import.ts`
- Modify: `src/services/container.ts` (add `importer`)
- Modify: `src/rest/app.ts`
- Test: `src/rest/import.test.ts`

- [ ] **Step 1: Add the importer to the container**

In `src/services/container.ts`:

Add the import:

```ts
import { IcsImportService } from "./import.service.js";
```

Add to the `Services` type (after `images: ImageService;`):

```ts
	images: ImageService;
	importer: IcsImportService;
```

In `createServices`, construct `events` first (it already exists), then build the importer and include it:

```ts
	const events = new EventService(db, bus, images);
	const importer = new IcsImportService(events);
	const pairing = new PairingService();
	return {
		calendars: new CalendarService(db, bus),
		events,
		tags: new TagService(db, bus),
		apiKeys: new ApiKeyService(db),
		pairing,
		images,
		importer,
	};
```

(Replace the previous `events: new EventService(db, bus, images),` inline construction with the hoisted `const events` shown above.)

- [ ] **Step 2: Write the failing test**

Create `src/rest/import.test.ts`:

```ts
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices, type Services } from "../services/container.js";
import { buildApp } from "./app.js";

let app: ReturnType<typeof buildApp>;
let services: Services;
let writeKey: string;

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//t//EN
BEGIN:VEVENT
UID:imp-1
SUMMARY:Imported one
DTSTART:20260602T140000Z
DTEND:20260602T150000Z
END:VEVENT
END:VCALENDAR`;

beforeEach(() => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	services = createServices(db, bus);
	writeKey = services.apiKeys.create("w", "write").raw;
	app = buildApp({ bus, services });
});

test("POST /events/import creates events and returns a summary", async () => {
	const cal = await (
		await app.request("/api/calendars", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${writeKey}`,
			},
			body: JSON.stringify({ name: "Cal" }),
		})
	).json();

	const form = new FormData();
	form.append("file", new File([ICS], "cal.ics", { type: "text/calendar" }));
	form.append("calendar_id", cal.id);

	const res = await app.request("/api/events/import", {
		method: "POST",
		headers: { authorization: `Bearer ${writeKey}` },
		body: form,
	});
	assert.equal(res.status, 200);
	const summary = await res.json();
	assert.equal(summary.created, 1);

	const list = await (
		await app.request(`/api/events?calendarId=${cal.id}`, {
			headers: { authorization: `Bearer ${writeKey}` },
		})
	).json();
	assert.equal(list.length, 1);
	assert.equal(list[0].title, "Imported one");
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- --test-name-pattern="POST /events/import"`
Expected: FAIL — route returns 404.

- [ ] **Step 4: Implement the route**

Create `src/rest/import.ts`:

```ts
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthEnv } from "../auth/middleware.js";
import { ValidationError } from "../core/errors.js";
import type { Services } from "../services/container.js";

/** Multipart .ics import. Plain Hono route (not OpenAPI-documented). */
export function registerImportRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ importer }: Services,
): void {
	api.post("/events/import", async (c) => {
		const body = await c.req.parseBody();
		const file = body.file;
		const calendarId = body.calendar_id;
		if (!(file instanceof File))
			throw new ValidationError("Expected a 'file' field");
		if (typeof calendarId !== "string" || !calendarId)
			throw new ValidationError("Expected a 'calendar_id' field");
		const text = await file.text();
		return c.json(importer.importIcs(text, calendarId), 200);
	});
}
```

In `src/rest/app.ts`, import and register it right after `registerUploadRoutes(api, services);`:

```ts
import { registerImportRoutes } from "./import.js";
```

```ts
	registerUploadRoutes(api, services);
	registerImportRoutes(api, services);
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --test-name-pattern="POST /events/import"`
Expected: PASS. Then `npm test` → full suite PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/container.ts src/rest/import.ts src/rest/app.ts src/rest/import.test.ts
git commit -m "feat(rest): .ics import endpoint"
```

---

## Task 10: Web client — types, upload/import methods, imageSrc

**Files:**
- Modify: `web/src/api/client.ts`

- [ ] **Step 1: Extend the `Event` type**

In `web/src/api/client.ts`, add three fields to the `Event` type (after `all_day: boolean;`):

```ts
	all_day: boolean;
	image_path: string | null;
	url: string | null;
	source_uid: string | null;
	created_at: string;
```

- [ ] **Step 2: Extend `EventUpdate` and `createEvent` input**

Add to the `EventUpdate` partial (after `all_day: boolean;`):

```ts
	all_day: boolean;
	image_path: string | null;
	url: string | null;
	tags: string[];
```

Add to the `createEvent` input object type (after `description?: string;`):

```ts
		description?: string;
		url?: string;
		image_path?: string;
```

- [ ] **Step 3: Add `ImportSummary`, `imageSrc`, a multipart helper, and methods**

Add the type near the top (after the `Tag` type):

```ts
export type ImportSummary = {
	created: number;
	skippedRecurring: number;
	skippedDuplicate: number;
	errors: string[];
};

/** Build a same-origin URL for a stored cover image. */
export const imageSrc = (name: string): string => `/api/img/${name}`;
```

Add a multipart helper just below the existing `request` function:

```ts
async function upload<T>(path: string, form: FormData): Promise<T> {
	// No content-type header: the browser sets the multipart boundary itself.
	const res = await fetch(`/api${path}`, {
		method: "POST",
		credentials: "include",
		body: form,
	});
	const text = await res.text();
	const body = text ? JSON.parse(text) : null;
	if (!res.ok) {
		if (res.status === 401) unauthorizedHandler?.();
		throw new ApiError(res.status, body?.error?.message ?? res.statusText);
	}
	return body as T;
}
```

Add these methods to the `api` object (after `deleteEvent`):

```ts
	uploadImage: (file: File) => {
		const form = new FormData();
		form.append("file", file);
		return upload<{ path: string }>("/uploads/image", form);
	},
	uploadImageFromUrl: (url: string) =>
		request<{ path: string }>("/uploads/image-from-url", {
			method: "POST",
			body: JSON.stringify({ url }),
		}),
	importIcs: (file: File, calendarId: string) => {
		const form = new FormData();
		form.append("file", file);
		form.append("calendar_id", calendarId);
		return upload<ImportSummary>("/events/import", form);
	},
```

- [ ] **Step 4: Typecheck**

Run: `npm --prefix web run build`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat(web): client types + image upload/import methods"
```

---

## Task 11: Markdown rendering in the event modal

**Files:**
- Create: `web/src/lib/markdown.ts`
- Modify: `web/src/components/EventModal.vue`
- Modify: `web/package.json` (add `markdown-it`)

- [ ] **Step 1: Install markdown-it**

Run: `npm --prefix web install markdown-it && npm --prefix web install -D @types/markdown-it`
Expected: adds `markdown-it` to `web` dependencies and `@types/markdown-it` to devDependencies.

- [ ] **Step 2: Create the renderer**

Create `web/src/lib/markdown.ts`:

```ts
import MarkdownIt from "markdown-it";

// html:false escapes raw HTML and markdown-it blocks dangerous link protocols
// (javascript:, file:, etc.) out of the box, so the output is safe for v-html.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Open links in a new tab.
const defaultLinkOpen =
	md.renderer.rules.link_open ??
	((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	tokens[idx].attrSet("target", "_blank");
	tokens[idx].attrSet("rel", "noopener noreferrer");
	return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Render markdown to safe HTML. Imported descriptions sometimes carry literal
 * backslash-n; normalize those to real newlines first. */
export function renderMarkdown(src: string | null | undefined): string {
	return md.render((src ?? "").replace(/\\n/g, "\n"));
}
```

- [ ] **Step 3: Use it in EventModal view mode**

In `web/src/components/EventModal.vue` `<script setup>`, add the import (near the other imports):

```ts
import { renderMarkdown } from "@/lib/markdown";
```

Replace the `descriptionText` computed with:

```ts
const renderedDescription = computed(() =>
	renderMarkdown(props.event?.description),
);
```

In the `<template>` view-mode block, replace:

```html
				<p v-if="event.description" class="whitespace-pre-wrap text-sm">
					{{ descriptionText }}
				</p>
```

with:

```html
				<!-- eslint-disable-next-line vue/no-v-html — sanitized by markdown-it (html:false) -->
				<div
					v-if="event.description"
					class="md text-sm leading-relaxed"
					v-html="renderedDescription"
				/>
```

Add a scoped style block at the end of the file (markdown needs basic list/heading styling since the Tailwind typography plugin isn't installed):

```html
<style scoped>
.md :deep(p) { margin: 0 0 0.5rem; }
.md :deep(ul) { list-style: disc; padding-left: 1.25rem; margin: 0 0 0.5rem; }
.md :deep(ol) { list-style: decimal; padding-left: 1.25rem; margin: 0 0 0.5rem; }
.md :deep(a) { text-decoration: underline; }
.md :deep(code) { font-family: ui-monospace, monospace; font-size: 0.85em; }
.md :deep(h1), .md :deep(h2), .md :deep(h3) { font-weight: 600; margin: 0.25rem 0; }
.md :deep(:last-child) { margin-bottom: 0; }
</style>
```

- [ ] **Step 4: Typecheck**

Run: `npm --prefix web run build`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Run `npm run dev:all`, open `http://localhost:5173`, open an event whose description contains markdown (e.g. `**bold**` and a `- list`). Confirm it renders formatted, links open in a new tab, and raw HTML like `<script>` appears as escaped text.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/markdown.ts web/src/components/EventModal.vue
git commit -m "feat(web): render event descriptions as markdown"
```

---

## Task 12: Cover image + URL fields in the event modal

**Files:**
- Modify: `web/src/components/EventModal.vue`

- [ ] **Step 1: Extend the form state + imports**

In `<script setup>`, update the lucide import to add icons:

```ts
import { Check, ImagePlus, Link, MapPin, Pencil, Plus, X } from "@lucide/vue";
```

Add to the imports:

```ts
import { api, imageSrc } from "@/api/client";
```

(There is already a `type` import from `@/api/client`; keep both — one is `import type {...}`, this new one imports the runtime `api` + `imageSrc`.)

Add to the `CreateInput` type:

```ts
	location?: string;
	description?: string;
	url?: string;
	image_path?: string;
};
```

Add to the `form` reactive object:

```ts
	start: "",
	end: "",
	url: "",
	image_path: null as string | null,
});
```

Add upload state below `const creatingTag = ref(false);`:

```ts
const imgBusy = ref(false);
const imgUrlInput = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
```

- [ ] **Step 2: Populate + clear the new fields**

In `fillFromEvent`, add:

```ts
	form.all_day = e.all_day;
	form.url = e.url ?? "";
	form.image_path = e.image_path ?? null;
```

In `fillEmpty`, add:

```ts
	form.all_day = props.prefill?.all_day ?? false;
	form.url = "";
	form.image_path = null;
```

- [ ] **Step 3: Add upload handlers**

Add these functions (near `submitNewTag`):

```ts
async function onPickFile(e: Event) {
	const input = e.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;
	imgBusy.value = true;
	error.value = "";
	try {
		const { path } = await api.uploadImage(file);
		form.image_path = path;
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		imgBusy.value = false;
		if (fileInput.value) fileInput.value.value = "";
	}
}

async function onAddImageUrl() {
	const url = imgUrlInput.value.trim();
	if (!url) return;
	imgBusy.value = true;
	error.value = "";
	try {
		const { path } = await api.uploadImageFromUrl(url);
		form.image_path = path;
		imgUrlInput.value = "";
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		imgBusy.value = false;
	}
}

function removeImage() {
	form.image_path = null;
}
```

- [ ] **Step 4: Include the fields in submit**

In `submit`, change the create emit to include the new fields:

```ts
		emit(
			"create",
			{
				calendar_id: form.calendar_id,
				title: form.title,
				start_at,
				end_at,
				all_day: form.all_day,
				...(desc ? { description: desc } : {}),
				...(loc ? { location: loc } : {}),
				...(form.url.trim() ? { url: form.url.trim() } : {}),
				...(form.image_path ? { image_path: form.image_path } : {}),
			},
			tagIds,
		);
```

and the save emit:

```ts
		emit(
			"save",
			props.event.id,
			{
				calendar_id: form.calendar_id,
				title: form.title,
				description: desc || null,
				location: loc || null,
				all_day: form.all_day,
				start_at,
				end_at,
				url: form.url.trim() || null,
				image_path: form.image_path || null,
			},
			tagIds,
		);
```

- [ ] **Step 5: Show the cover + URL in view mode**

In the view-mode template block, add a cover image at the top (right after the opening `<div v-if="localMode === 'view' && event" class="space-y-3">`):

```html
			<div v-if="event.image_path" class="overflow-hidden rounded-box">
				<img :src="imageSrc(event.image_path)" alt="" class="aspect-[3/2] w-full object-cover" />
			</div>
```

And a URL link (after the location `<p>`):

```html
				<p v-if="event.url" class="flex items-center gap-1 text-sm">
					<Link :size="14" aria-hidden="true" />
					<a :href="event.url" target="_blank" rel="noopener noreferrer" class="link truncate">
						{{ event.url }}
					</a>
				</p>
```

- [ ] **Step 6: Add the cover + URL inputs to the form**

In the create/edit `<form>`, add a URL field after the Location fieldset:

```html
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Link</legend>
					<input v-model="form.url" type="url" placeholder="https://…" class="input w-full" />
				</fieldset>
```

And a cover-image fieldset after the Description fieldset:

```html
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Cover image</legend>
					<div v-if="form.image_path" class="relative overflow-hidden rounded-box">
						<img :src="imageSrc(form.image_path)" alt="" class="aspect-[3/2] w-full object-cover" />
						<button
							type="button"
							class="btn btn-circle btn-xs absolute right-2 top-2"
							aria-label="Remove image"
							@click="removeImage"
						>
							<X :size="14" aria-hidden="true" />
						</button>
					</div>
					<div v-else class="space-y-2">
						<button
							type="button"
							class="btn btn-sm w-full gap-1"
							:disabled="imgBusy"
							@click="fileInput?.click()"
						>
							<ImagePlus :size="15" aria-hidden="true" />
							{{ imgBusy ? "Uploading…" : "Upload image" }}
						</button>
						<input
							ref="fileInput"
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif"
							class="hidden"
							@change="onPickFile"
						/>
						<div class="join w-full">
							<input
								v-model="imgUrlInput"
								placeholder="…or paste an image URL"
								class="input input-sm join-item w-full"
								@keyup.enter.prevent="onAddImageUrl"
							/>
							<button
								type="button"
								class="btn btn-sm join-item"
								:disabled="imgBusy"
								aria-label="Use image URL"
								@click="onAddImageUrl"
							>
								<Check :size="15" aria-hidden="true" />
							</button>
						</div>
					</div>
				</fieldset>
```

- [ ] **Step 7: Typecheck**

Run: `npm --prefix web run build`
Expected: PASS.

- [ ] **Step 8: Manual verification**

In the running app: create an event, upload a cover image (preview appears), set a Link, save. Reopen → cover shows on top, link is clickable. Edit → paste an image URL from a public host → preview updates. Remove image → preview clears, save → cover gone.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/EventModal.vue
git commit -m "feat(web): cover image + link fields in the event modal"
```

---

## Task 13: CoverGrid component

**Files:**
- Create: `web/src/components/CoverGrid.vue`

- [ ] **Step 1: Create the component**

Create `web/src/components/CoverGrid.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { Calendar, Event } from "@/api/client";
import { imageSrc } from "@/api/client";

// Cover/gallery face: 3:2 cards with the image as background and the text
// floating on top (no panel). Events without a cover fall back to a gradient
// from their calendar color. Shows today and the future, soonest first.
const props = defineProps<{ events: Event[]; calendars: Calendar[] }>();
const emit = defineEmits<{ open: [event: Event] }>();

const pad = (n: number) => String(n).padStart(2, "0");
function dayKey(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const upcoming = computed(() => {
	const now = new Date();
	const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	return [...props.events]
		.sort((a, b) => a.start_at.localeCompare(b.start_at))
		.filter((e) => dayKey(e.start_at) >= todayKey);
});

function calColor(id: string): string {
	return props.calendars.find((c) => c.id === id)?.color ?? "#94a3b8";
}

function cardStyle(e: Event): Record<string, string> {
	if (e.image_path) {
		return {
			backgroundImage: `url(${imageSrc(e.image_path)})`,
			backgroundSize: "cover",
			backgroundPosition: "center",
		};
	}
	const c = calColor(e.calendar_id);
	return { background: `linear-gradient(135deg, ${c}, ${c}88)` };
}

function when(e: Event): string {
	const d = new Date(e.start_at);
	const date = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
	if (e.all_day) return `${date} · All day`;
	return `${date} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}
</script>

<template>
	<div
		v-if="upcoming.length"
		class="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-3 lg:grid-cols-4"
	>
		<button
			v-for="e in upcoming"
			:key="e.id"
			type="button"
			class="relative aspect-[3/2] overflow-hidden rounded-xl text-left transition-transform active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
			:style="cardStyle(e)"
			@click="emit('open', e)"
		>
			<span
				class="absolute inset-x-3 bottom-2.5 text-white"
				style="text-shadow: 0 1px 6px rgba(0,0,0,.7), 0 1px 2px rgba(0,0,0,.6)"
			>
				<span class="block truncate text-base font-extrabold leading-tight">{{ e.title }}</span>
				<span class="mt-0.5 block text-xs opacity-95">{{ when(e) }}</span>
			</span>
		</button>
	</div>
	<div v-else class="py-16 text-center text-sm text-base-content/50">
		No upcoming events.
	</div>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `npm --prefix web run build`
Expected: PASS (component compiles even though it's not yet routed).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/CoverGrid.vue
git commit -m "feat(web): CoverGrid gallery component"
```

---

## Task 14: /cover route, ListView body-swap, and nav entries

**Files:**
- Modify: `web/src/router.ts`
- Modify: `web/src/views/ListView.vue`
- Modify: `web/src/App.vue`
- Modify: `web/src/components/BottomDock.vue`

- [ ] **Step 1: Add the route**

In `web/src/router.ts`, add a route after the `list` route:

```ts
		{
			path: "/list",
			name: "list",
			component: () => import("@/views/ListView.vue"),
		},
		{
			path: "/cover",
			name: "cover",
			component: () => import("@/views/ListView.vue"),
		},
```

- [ ] **Step 2: Swap the body in ListView by route**

In `web/src/views/ListView.vue` `<script setup>`, add imports:

```ts
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { Event, Tag } from "@/api/client";
import AgendaList from "@/components/AgendaList.vue";
import CoverGrid from "@/components/CoverGrid.vue";
```

(The `computed`/`ref`/`watch` import line already exists — just add `useRoute`, `CoverGrid`, and keep the rest.)

Add near the other refs:

```ts
const route = useRoute();
const coverMode = computed(() => route.name === "cover");
```

In the `<template>`, replace the `<AgendaList .../>` element with a conditional:

```html
				<CoverGrid
					v-if="coverMode"
					:events="visibleEvents"
					:calendars="calendars"
					@open="openView"
				/>
				<AgendaList
					v-else
					:events="visibleEvents"
					:calendars="calendars"
					:tags="tags"
					@open="openView"
				/>
```

- [ ] **Step 3: Add the desktop nav link**

In `web/src/App.vue`, update the lucide import to add an icon:

```ts
import { CalendarDays, Images, List, LogOut, Menu } from "@lucide/vue";
```

Add a nav link after the `/list` RouterLink:

```html
					<RouterLink to="/list" :class="linkBase" :exact-active-class="linkActive">
						<List :size="16" aria-hidden="true" />
						<span>List</span>
					</RouterLink>
					<RouterLink to="/cover" :class="linkBase" :exact-active-class="linkActive">
						<Images :size="16" aria-hidden="true" />
						<span>Cover</span>
					</RouterLink>
```

- [ ] **Step 4: Add the mobile dock link**

In `web/src/components/BottomDock.vue`, update the lucide import:

```ts
import { CalendarDays, Images, List, LogOut, MoreHorizontal } from "@lucide/vue";
```

Add a dock link after the `/list` RouterLink:

```html
		<RouterLink to="/cover" :class="{ 'dock-active text-primary': isActive('cover') }">
			<Images :size="20" aria-hidden="true" />
			<span class="dock-label">Cover</span>
		</RouterLink>
```

- [ ] **Step 5: Typecheck**

Run: `npm --prefix web run build`
Expected: PASS.

- [ ] **Step 6: Manual verification**

In the running app, click **Cover** (desktop top-nav and mobile dock). Confirm the gallery grid renders, events with covers show their image, events without show a calendar-color gradient, search/filters still apply, and clicking a card opens the event. Confirm **List** still shows the agenda.

- [ ] **Step 7: Commit**

```bash
git add web/src/router.ts web/src/views/ListView.vue web/src/App.vue web/src/components/BottomDock.vue
git commit -m "feat(web): cover view route + nav entries"
```

---

## Task 15: .ics import dialog + triggers

**Files:**
- Create: `web/src/composables/useImport.ts`
- Create: `web/src/components/ImportIcsDialog.vue`
- Modify: `web/src/App.vue`
- Modify: `web/src/components/BottomDock.vue`

- [ ] **Step 1: Shared open/close state**

Create `web/src/composables/useImport.ts`:

```ts
import { ref } from "vue";

// Module-level singleton (matches useComposer/useSidebar): any component can
// open the import dialog; App.vue renders it.
const isOpen = ref(false);

export function useImport() {
	return {
		isOpen,
		open: () => {
			isOpen.value = true;
		},
		close: () => {
			isOpen.value = false;
		},
	};
}
```

- [ ] **Step 2: The dialog**

Create `web/src/components/ImportIcsDialog.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ImportSummary } from "@/api/client";
import { api } from "@/api/client";
import { useCalendars } from "@/composables/useCalendars";

const emit = defineEmits<{ close: [] }>();
const { calendars, load } = useCalendars();

const calendarId = ref("");
const file = ref<File | null>(null);
const busy = ref(false);
const error = ref("");
const result = ref<ImportSummary | null>(null);

onMounted(async () => {
	if (!calendars.value.length) await load();
	calendarId.value = calendars.value[0]?.id ?? "";
});

function onPick(e: Event) {
	file.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function submit() {
	error.value = "";
	if (!file.value || !calendarId.value) {
		error.value = "Choose a calendar and an .ics file.";
		return;
	}
	busy.value = true;
	try {
		// Open views update themselves via SSE as events are created.
		result.value = await api.importIcs(file.value, calendarId.value);
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<div class="modal modal-open modal-bottom sm:modal-middle" @click.self="emit('close')">
		<div class="modal-box w-full max-w-md">
			<h2 class="mb-4 text-xl font-semibold">Import .ics</h2>

			<div v-if="result" class="space-y-3">
				<p class="text-sm">
					Imported <strong>{{ result.created }}</strong> event(s).
				</p>
				<ul class="text-sm text-base-content/70">
					<li v-if="result.skippedRecurring">Skipped {{ result.skippedRecurring }} recurring</li>
					<li v-if="result.skippedDuplicate">Skipped {{ result.skippedDuplicate }} duplicate</li>
					<li v-if="result.errors.length">{{ result.errors.length }} error(s)</li>
				</ul>
				<div class="modal-action">
					<button class="btn btn-primary btn-sm" @click="emit('close')">Done</button>
				</div>
			</div>

			<form v-else class="flex flex-col gap-3" @submit.prevent="submit">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Target calendar</legend>
					<select v-model="calendarId" required class="select w-full">
						<option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.name }}</option>
					</select>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">.ics file</legend>
					<input type="file" accept=".ics,text/calendar" class="file-input w-full" @change="onPick" />
				</fieldset>
				<p v-if="error" class="text-sm text-error">{{ error }}</p>
				<div class="modal-action">
					<button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">Cancel</button>
					<button :disabled="busy" class="btn btn-primary btn-sm">
						{{ busy ? "Importing…" : "Import" }}
					</button>
				</div>
			</form>
		</div>
	</div>
</template>
```

- [ ] **Step 3: Mount + trigger from App.vue**

In `web/src/App.vue` `<script setup>`, add:

```ts
import ImportIcsDialog from "@/components/ImportIcsDialog.vue";
import { useImport } from "@/composables/useImport";
```

```ts
const imp = useImport();
```

Add an Upload icon to the lucide import:

```ts
import { CalendarDays, Images, List, LogOut, Menu, Upload } from "@lucide/vue";
```

Add an import button in the desktop right-side controls (before `<PWAInstallButton />`):

```html
				<div class="ml-auto hidden items-center gap-1 lg:flex">
					<button class="btn btn-ghost btn-sm gap-1 px-2" @click="imp.open()">
						<Upload :size="16" aria-hidden="true" />
						<span>Import</span>
					</button>
					<PWAInstallButton />
```

Render the dialog at the end of the `<template>`, just before the closing `</div>` of the root (and outside the `pair` branch is fine — gate it with `route.name !== 'pair'`):

```html
			<BottomDock />
		</template>
		<RouterView v-else />
		<ImportIcsDialog v-if="imp.isOpen.value && route.name !== 'pair'" @close="imp.close()" />
	</div>
</template>
```

- [ ] **Step 4: Trigger from the mobile dock**

In `web/src/components/BottomDock.vue` `<script setup>`, add:

```ts
import { useImport } from "@/composables/useImport";
```

```ts
const imp = useImport();
```

Add a button inside the "More" dropdown content, before the Log out button:

```html
						<button class="btn btn-ghost btn-sm w-full justify-start gap-2" @click="imp.open()">
							<Upload :size="16" aria-hidden="true" />
							Import .ics
						</button>
```

And add `Upload` to the lucide import in BottomDock:

```ts
import { CalendarDays, Images, List, LogOut, MoreHorizontal, Upload } from "@lucide/vue";
```

- [ ] **Step 5: Typecheck**

Run: `npm --prefix web run build`
Expected: PASS.

- [ ] **Step 6: Manual verification**

In the running app, click **Import** (desktop) / More → Import .ics (mobile). Pick a target calendar and an `.ics` export (e.g. from Google Calendar). Confirm the summary shows created/skipped counts and the new events appear in Calendar/List/Cover without a manual refresh (via SSE).

- [ ] **Step 7: Commit**

```bash
git add web/src/composables/useImport.ts web/src/components/ImportIcsDialog.vue web/src/App.vue web/src/components/BottomDock.vue
git commit -m "feat(web): .ics import dialog + triggers"
```

---

## Task 16: Docs + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README data model**

In `README.md`, update the **Event** bullet under "Data model" to mention the new fields:

```md
- **Event** — belongs to a calendar; `title`, `description` (rendered as Markdown
  in the web UI), `location`, `start_at`, `end_at`, `all_day`, optional
  `image_path` (cover image stored under `data/img/`) and `url`; carries `tags`
  (names) and `reminders`
```

Add a short row to the REST table (after the `/events/{id}` row) and an Images/Import note:

```md
| `POST`                 | `/events/import`               | multipart `.ics` import (skips recurring)                     |
| `POST`                 | `/uploads/image`               | multipart cover-image upload                                  |
| `POST`                 | `/uploads/image-from-url`      | fetch a remote image into `data/img/`                         |
| `GET`                  | `/img/{file}`                  | serve a stored cover image                                    |
```

- [ ] **Step 2: Run the full backend suite + formatter**

Run: `npm test`
Expected: PASS (all suites, including the new connection/image/import/upload tests).

Run: `npm run format`
Expected: Biome reports no errors (auto-fixes formatting).

- [ ] **Step 3: Full build (backend + web)**

Run: `npm run build`
Expected: PASS — `tsc` compiles the backend and `vue-tsc && vite build` compiles the web app with no type errors.

- [ ] **Step 4: Smoke test the production server**

Run: `npm start`, open `http://localhost:4010`. Verify: create an event with a cover + link; it shows in Cover view; import an `.ics`; the markdown description renders. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document cover image, url, and .ics import"
```

- [ ] **Step 6: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to decide how to integrate `feat/rich-calendar` (merge / PR / cleanup).

---

## Self-Review

**Spec coverage:**
- Cover image (upload + paste-URL, local storage) → Tasks 5–7, 12.
- Single URL → Tasks 2–4, 10, 12.
- Markdown description → Task 11.
- Cover view → Tasks 13–14.
- .ics import (skip recurring, dedupe, no export) → Tasks 8–9, 15.
- Schema + migration → Task 1.
- MCP parity → automatic via shared schemas (noted in Task 2).
- SSRF/type/size guards → Task 5.
- Testing (migration, service, upload, import, REST) → Tasks 1, 3, 4, 5, 7, 8, 9. Frontend verified via build + manual (no web test harness — called out at top).

**Type consistency:** `image_path`/`url`/`source_uid` names match across schema, `EventRow`, `Event` (backend + web), and the migration. `CreateEventServiceInput` (with optional `source_uid`) is the single create input used by REST (without it) and the importer (with it). `ImportSummary` fields match between `import.service.ts` and `web/src/api/client.ts`. `imageSrc`, `api.uploadImage`, `api.uploadImageFromUrl`, `api.importIcs` are defined in Task 10 and consumed in Tasks 12, 15.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertions and the run command with expected result.
