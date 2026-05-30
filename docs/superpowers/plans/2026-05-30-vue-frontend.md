# Vue Frontend + PIN Pairing Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Vue 3 SPA in `web/` that drives the existing Hono calendar REST/SSE API, authenticated by a `npm run auth` PIN-pairing flow that sets an HttpOnly cookie.

**Architecture:** Backend gains an in-memory PIN service, public `pair`/`logout` and authed `pin`/`session` routes, cookie-aware auth middleware, rate limiting, and static serving of `web/dist`. The frontend is an independent Vite project that talks to `/api` (proxied in dev, same-origin in prod) and shares types from `src/schemas`.

**Tech Stack:** Backend — Hono, @hono/zod-openapi, better-sqlite3, node:test. Frontend — Vue 3, Vite, Tailwind CSS v4, Vue Router, Schedule-X (`/schedule-x/schedule-x` v3, confirmed API).

**Reference spec:** `docs/superpowers/specs/2026-05-30-vue-frontend-design.md`

---

## File Structure

**Backend (create):**
- `src/auth/pairing.ts` — in-memory PIN service (create/redeem, one-time, TTL)
- `src/auth/pairing.test.ts`
- `src/auth/rate-limit.ts` — in-memory failure-count limiter
- `src/auth/rate-limit.test.ts`
- `src/rest/auth.ts` — public `pair`/`logout` + authed `pin`/`session` route registrars
- `src/rest/auth.test.ts`
- `scripts/auth.ts` — CLI that mints a PIN via the running server

**Backend (modify):**
- `src/auth/middleware.ts` — read `yot_session` cookie in `extractRawKey`
- `src/services/container.ts` — add `PairingService` to `Services`
- `src/rest/app.ts` — register auth routes in the right middleware order
- `src/index.ts` — serve `web/dist` with SPA fallback; drop `INDEX_HTML`
- `package.json` — add `auth`, `web:dev`, `web:build` scripts; extend `build`
- `src/web/page.ts` — delete

**Frontend (create) under `web/`:**
- `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `.gitignore`
- `src/main.ts`, `src/App.vue`, `src/style.css`, `src/router.ts`
- `src/api/client.ts`
- `src/composables/useAuth.ts`, `useCalendars.ts`, `useEvents.ts`, `useTags.ts`, `useSSE.ts`
- `src/views/PairView.vue`, `CalendarView.vue`, `ListView.vue`
- `src/components/Sidebar.vue`, `EventForm.vue`

---

## Task 1: PairingService (in-memory PIN)

**Files:**
- Create: `src/auth/pairing.ts`
- Test: `src/auth/pairing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/auth/pairing.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PairingService } from "./pairing.js";

describe("PairingService", () => {
	it("creates a 6-digit pin and redeems it once with its scope", () => {
		const svc = new PairingService();
		const pin = svc.createPin("write");
		assert.match(pin, /^\d{6}$/);
		assert.equal(svc.redeem(pin), "write");
		assert.equal(svc.redeem(pin), null); // one-time
	});

	it("returns null for an unknown pin", () => {
		const svc = new PairingService();
		assert.equal(svc.redeem("000000"), null);
	});

	it("rejects an expired pin", () => {
		const svc = new PairingService(-1); // TTL in the past
		const pin = svc.createPin("read");
		assert.equal(svc.redeem(pin), null);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="PairingService"`
Expected: FAIL — `Cannot find module './pairing.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/auth/pairing.ts
import { randomInt } from "node:crypto";
import { hashKey, type Scope } from "./apikey.js";

const PIN_TTL_MS = 5 * 60 * 1000;

type PinEntry = { scope: Scope; expiresAt: number };

/**
 * Short-lived pairing PINs held only in this process's memory. A PIN is minted
 * by an authenticated client (scripts/auth.ts → POST /api/auth/pin) and redeemed
 * once by the browser (POST /api/auth/pair). PINs are stored hashed and removed
 * on first redemption, so they cannot be replayed.
 */
export class PairingService {
	private readonly pins = new Map<string, PinEntry>();

	constructor(private readonly ttlMs: number = PIN_TTL_MS) {}

	/** Mint a fresh 6-digit PIN bound to a scope. Returns the raw PIN. */
	createPin(scope: Scope): string {
		const pin = randomInt(0, 1_000_000).toString().padStart(6, "0");
		this.pins.set(hashKey(pin), { scope, expiresAt: Date.now() + this.ttlMs });
		return pin;
	}

	/** Consume a PIN (one-time). Returns its scope, or null if invalid/expired. */
	redeem(pin: string): Scope | null {
		const h = hashKey(pin);
		const entry = this.pins.get(h);
		if (!entry) return null;
		this.pins.delete(h);
		if (entry.expiresAt < Date.now()) return null;
		return entry.scope;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="PairingService"`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth/pairing.ts src/auth/pairing.test.ts
git commit -m "feat(auth): add in-memory PIN pairing service"
```

---

## Task 2: RateLimiter

**Files:**
- Create: `src/auth/rate-limit.ts`
- Test: `src/auth/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/auth/rate-limit.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
	it("blocks a key after reaching max failures and unblocks on reset", () => {
		const rl = new RateLimiter(2, 60_000);
		assert.equal(rl.isBlocked("ip"), false);
		rl.recordFailure("ip");
		assert.equal(rl.isBlocked("ip"), false);
		rl.recordFailure("ip");
		assert.equal(rl.isBlocked("ip"), true);
		rl.reset("ip");
		assert.equal(rl.isBlocked("ip"), false);
	});

	it("expires the window", () => {
		const rl = new RateLimiter(1, -1); // window already elapsed
		rl.recordFailure("ip");
		assert.equal(rl.isBlocked("ip"), false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="RateLimiter"`
Expected: FAIL — `Cannot find module './rate-limit.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/auth/rate-limit.ts
type Bucket = { count: number; resetAt: number };

/** Fixed-window failure counter keyed by an arbitrary string (e.g. client IP). */
export class RateLimiter {
	private readonly buckets = new Map<string, Bucket>();

	constructor(
		private readonly max: number = 5,
		private readonly windowMs: number = 60_000,
	) {}

	isBlocked(key: string): boolean {
		const b = this.buckets.get(key);
		if (!b) return false;
		if (b.resetAt < Date.now()) {
			this.buckets.delete(key);
			return false;
		}
		return b.count >= this.max;
	}

	recordFailure(key: string): void {
		const nowMs = Date.now();
		const b = this.buckets.get(key);
		if (!b || b.resetAt < nowMs) {
			this.buckets.set(key, { count: 1, resetAt: nowMs + this.windowMs });
			return;
		}
		b.count++;
	}

	reset(key: string): void {
		this.buckets.delete(key);
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="RateLimiter"`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth/rate-limit.ts src/auth/rate-limit.test.ts
git commit -m "feat(auth): add fixed-window rate limiter"
```

---

## Task 3: Wire PairingService into the service container

**Files:**
- Modify: `src/services/container.ts`

- [ ] **Step 1: Add the import**

In `src/services/container.ts`, add after the existing auth import:

```ts
import { PairingService } from "../auth/pairing.js";
```

- [ ] **Step 2: Extend the Services type**

```ts
export type Services = {
	calendars: CalendarService;
	events: EventService;
	tags: TagService;
	apiKeys: ApiKeyService;
	pairing: PairingService;
};
```

- [ ] **Step 3: Construct and return it**

In `createServices`, add `const pairing = new PairingService();` alongside the other constructions and include `pairing` in the returned object.

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/container.ts
git commit -m "feat(services): expose PairingService from the container"
```

---

## Task 4: Read the session cookie in auth middleware

**Files:**
- Modify: `src/auth/middleware.ts`

- [ ] **Step 1: Add the cookie import**

At the top of `src/auth/middleware.ts`:

```ts
import { getCookie } from "hono/cookie";
```

- [ ] **Step 2: Read the cookie in `extractRawKey`**

Replace the body of `extractRawKey` with (cookie checked after headers, before the query fallback):

```ts
function extractRawKey(c: Context): string | null {
	const auth = c.req.header("authorization");
	if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
	if (auth?.trim()) return auth.trim();
	const x = c.req.header("x-api-key");
	if (x?.trim()) return x.trim();
	const cookie = getCookie(c, "yot_session");
	if (cookie?.trim()) return cookie.trim();
	// Fallback for browser EventSource (cannot set headers) on the SSE feed.
	return c.req.query("key")?.trim() || null;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/auth/middleware.ts
git commit -m "feat(auth): accept yot_session cookie as a key source"
```

---

## Task 5: Auth routes (pair / logout / pin / session)

**Files:**
- Create: `src/rest/auth.ts`
- Test: `src/rest/auth.test.ts`
- Modify: `src/rest/app.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/rest/auth.test.ts
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices, type Services } from "../services/container.js";
import { buildApp } from "./app.js";

let app: ReturnType<typeof buildApp>;
let services: Services;
let writeKey: string;

async function mintPin(key: string, scope = "write") {
	const res = await app.request("/api/auth/pin", {
		method: "POST",
		headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({ scope }),
	});
	return res;
}

beforeEach(() => {
	const db = openDb(":memory:");
	const bus = new EventBus();
	services = createServices(db, bus);
	writeKey = services.apiKeys.create("test", "write").raw;
	app = buildApp({ bus, services });
});

describe("auth pairing", () => {
	it("mints a pin and pairs into an HttpOnly session cookie", async () => {
		const { pin } = await (await mintPin(writeKey)).json();
		const pairRes = await app.request("/api/auth/pair", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pin }),
		});
		assert.equal(pairRes.status, 200);
		const setCookie = pairRes.headers.get("set-cookie") ?? "";
		assert.match(setCookie, /yot_session=/);
		assert.match(setCookie, /HttpOnly/i);
	});

	it("rejects an invalid pin", async () => {
		const res = await app.request("/api/auth/pair", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pin: "000000" }),
		});
		assert.equal(res.status, 401);
	});

	it("authenticates a later request using the session cookie", async () => {
		const { pin } = await (await mintPin(writeKey)).json();
		const pairRes = await app.request("/api/auth/pair", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pin }),
		});
		const cookie = (pairRes.headers.get("set-cookie") ?? "").split(";")[0];
		const calRes = await app.request("/api/calendars", { headers: { Cookie: cookie } });
		assert.equal(calRes.status, 200);
	});

	it("does not let a read key mint a write pin", async () => {
		const readKey = services.apiKeys.create("ro", "read").raw;
		const res = await mintPin(readKey, "write");
		assert.equal(res.status, 200);
		const { scope } = await res.json();
		assert.equal(scope, "read");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="auth pairing"`
Expected: FAIL — routes return 404 / module `./auth.js` missing.

- [ ] **Step 3: Create the route registrars**

```ts
// src/rest/auth.ts
import { getConnInfo } from "@hono/node-server/conninfo";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthEnv } from "../auth/middleware.js";
import { RateLimiter } from "../auth/rate-limit.js";
import { UnauthorizedError } from "../core/errors.js";
import type { Services } from "../services/container.js";

const COOKIE = "yot_session";
const TEN_YEARS_S = 60 * 60 * 24 * 365 * 10;

function clientIp(c: Context<AuthEnv>): string {
	try {
		return getConnInfo(c).remote.address ?? "unknown";
	} catch {
		return "unknown";
	}
}

/** Public auth routes: must be registered BEFORE the authenticate() gate. */
export function registerPublicAuthRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ pairing, apiKeys }: Services,
): void {
	const limiter = new RateLimiter();

	api.post("/auth/pair", async (c) => {
		const ip = clientIp(c);
		if (limiter.isBlocked(ip)) {
			return c.json(
				{ error: { code: "rate_limited", message: "Too many attempts" } },
				429,
			);
		}
		const body = (await c.req.json().catch(() => ({}))) as { pin?: unknown };
		const pin = typeof body.pin === "string" ? body.pin : "";
		const scope = pairing.redeem(pin);
		if (!scope) {
			limiter.recordFailure(ip);
			throw new UnauthorizedError("Invalid or expired PIN");
		}
		limiter.reset(ip);
		const { raw } = apiKeys.create("web", scope);
		const secure = new URL(c.req.url).protocol === "https:";
		setCookie(c, COOKIE, raw, {
			httpOnly: true,
			sameSite: "Strict",
			path: "/",
			maxAge: TEN_YEARS_S,
			secure,
		});
		return c.json({ ok: true, scope }, 200);
	});

	api.post("/auth/logout", (c) => {
		const raw = getCookie(c, COOKIE);
		if (raw) {
			const key = apiKeys.findByRawKey(raw);
			if (key) apiKeys.revoke(key.id);
		}
		deleteCookie(c, COOKIE, { path: "/" });
		return c.json({ ok: true }, 200);
	});
}

/**
 * Authenticated auth routes: register AFTER authenticate() but BEFORE
 * requireWriteForMutations() so a read-only key may still POST /auth/pin.
 */
export function registerAuthedAuthRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ pairing }: Services,
): void {
	api.post("/auth/pin", async (c) => {
		const caller = c.get("apiKey");
		const body = (await c.req.json().catch(() => ({}))) as { scope?: unknown };
		const requested = body.scope === "read" ? "read" : "write";
		// No escalation: a read key can only mint a read PIN.
		const scope = caller.scope === "read" ? "read" : requested;
		const pin = pairing.createPin(scope);
		return c.json({ pin, scope, expires_in: 300 }, 200);
	});

	api.get("/auth/session", (c) => {
		return c.json({ scope: c.get("apiKey").scope }, 200);
	});
}
```

- [ ] **Step 4: Register routes in app.ts (correct middleware order)**

In `src/rest/app.ts`, add the import:

```ts
import { registerAuthedAuthRoutes, registerPublicAuthRoutes } from "./auth.js";
```

Then change the middleware/route section so the order is exactly:

```ts
	// --- public ---
	api.get("/health", (c) => c.json({ status: "ok" }));
	api.doc("/doc", {
		openapi: "3.0.0",
		info: {
			title: "Calendar API",
			version: "1.0.0",
			description: "Single-user calendar backend",
		},
	});
	api.get("/ui", (c) => c.html(SWAGGER_HTML));
	registerPublicAuthRoutes(api, services);

	// --- auth gate ---
	api.use("*", authenticate(services.apiKeys));
	registerAuthedAuthRoutes(api, services); // authed but scope-agnostic
	api.use("*", requireWriteForMutations());

	// --- protected ---
	registerCalendarRoutes(api, services);
	registerEventRoutes(api, services);
	registerTagRoutes(api, services);
	registerStreamRoute(api, bus);
	registerInternalRoutes(api, bus);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="auth pairing"`
Expected: PASS (4 tests). Then run the full suite: `npm test` — all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/rest/auth.ts src/rest/auth.test.ts src/rest/app.ts
git commit -m "feat(auth): add pair/logout/pin/session routes"
```

---

## Task 6: `npm run auth` CLI

**Files:**
- Create: `scripts/auth.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the script entry**

In `package.json` `scripts`, add after `"init"`:

```json
		"auth": "tsx scripts/auth.ts",
```

- [ ] **Step 2: Write the CLI**

```ts
// scripts/auth.ts
import { intro, isCancel, note, outro, select } from "@clack/prompts";

try {
	process.loadEnvFile();
} catch {}

const PORT = Number(process.env.PORT ?? 4010);
const KEY = process.env.YOT_API_KEY;
const BASE = `http://localhost:${PORT}`;

async function main() {
	intro("Pair a browser with the calendar backend");

	if (!KEY) {
		outro("No YOT_API_KEY in .env — run `npm run init` first.");
		process.exit(1);
	}

	const scope = await select({
		message: "Scope for this browser session",
		options: [
			{ value: "write", label: "write — full read/write access" },
			{ value: "read", label: "read — read-only access" },
		],
	});
	if (isCancel(scope)) {
		outro("Cancelled.");
		process.exit(0);
	}

	let res: Response;
	try {
		res = await fetch(`${BASE}/api/auth/pin`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				Authorization: `Bearer ${KEY}`,
			},
			body: JSON.stringify({ scope }),
		});
	} catch {
		outro(`Could not reach ${BASE}. Is the server running? (npm run dev)`);
		process.exit(1);
	}

	if (!res.ok) {
		outro(`Server returned ${res.status}. Check that YOT_API_KEY is valid.`);
		process.exit(1);
	}

	const { pin } = (await res.json()) as { pin: string };
	note(
		`Pairing PIN:   ${pin}\n\nValid for 5 minutes. Enter it in the browser.`,
		"Enter this PIN in the web app",
	);
	outro("Waiting for you to pair in the browser…");
}

await main();
```

- [ ] **Step 3: Manually verify**

Run (in one terminal) `npm run dev`, then (in another) `npm run auth`. Choose `write`.
Expected: a 6-digit PIN is printed. With the server stopped, `npm run auth` prints the "Could not reach" message.

- [ ] **Step 4: Commit**

```bash
git add scripts/auth.ts package.json
git commit -m "feat(cli): add npm run auth PIN pairing command"
```

---

## Task 7: Serve `web/dist` with SPA fallback; remove old console

**Files:**
- Modify: `src/index.ts`
- Delete: `src/web/page.ts`

- [ ] **Step 1: Update `src/index.ts`**

Replace the `INDEX_HTML` import and the `app.get("/", ...)` block. New `src/index.ts`:

```ts
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { EventBus } from "./core/event-bus.js";
import { openDb } from "./db/connection.js";
import { buildApp } from "./rest/app.js";
import { createServices } from "./services/container.js";

// Load .env (PORT, DB_PATH, MCP_AUTH, ...) if present. Real env vars win.
try {
	process.loadEnvFile();
} catch {
	// No .env file — rely on the ambient environment.
}

const DB_PATH = process.env.DB_PATH ?? "data.db";
const PORT = Number(process.env.PORT ?? 4010);

const db = openDb(DB_PATH);
const bus = new EventBus();
const services = createServices(db, bus);

const app = buildApp({ bus, services, logging: true });

// Serve the built Vue SPA (web/dist). Static assets first, then an
// index.html fallback so client-side routes (/list, /pair) resolve.
app.use("/*", serveStatic({ root: "./web/dist" }));
app.get("*", serveStatic({ path: "./web/dist/index.html" }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`Calendar backend listening on http://localhost:${info.port}`);
	console.log(`  Web    http://localhost:${info.port}/`);
	console.log(`  REST   http://localhost:${info.port}/api`);
	console.log(`  Docs   http://localhost:${info.port}/api/ui`);
	console.log(`  SSE    http://localhost:${info.port}/api/stream`);
});
```

- [ ] **Step 2: Delete the old dev console**

Run: `git rm src/web/page.ts`
(`src/web/page.ts` is only imported by `src/index.ts`, which no longer references it.)

- [ ] **Step 3: Verify it compiles and serves API**

Run: `npm run build` (expect no type errors), then `npm run dev`. With no `web/dist` yet, `GET /` returns 404 (expected until the frontend is built) but `GET /api/health` returns `{"status":"ok"}`.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(server): serve web/dist SPA, remove inline dev console"
```

---

## Task 8: Scaffold the `web/` Vite project

**Files (create):**
- `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/index.html`, `web/.gitignore`, `web/src/main.ts`, `web/src/style.css`

- [ ] **Step 1: Create `web/package.json`**

```json
{
	"name": "yot-web",
	"private": true,
	"type": "module",
	"scripts": {
		"dev": "vite",
		"build": "vue-tsc -b && vite build",
		"preview": "vite preview"
	},
	"dependencies": {
		"@schedule-x/calendar": "^3.34.0",
		"@schedule-x/events-service": "^3.34.0",
		"@schedule-x/theme-default": "^3.34.0",
		"@schedule-x/vue": "^3.34.0",
		"vue": "^3.5.13",
		"vue-router": "^4.5.0"
	},
	"devDependencies": {
		"@tailwindcss/vite": "^4.0.0",
		"@vitejs/plugin-vue": "^5.2.1",
		"tailwindcss": "^4.0.0",
		"typescript": "^5.8.3",
		"vue-tsc": "^2.2.0",
		"vite": "^6.0.0"
	}
}
```

- [ ] **Step 2: Create `web/vite.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [vue(), tailwindcss()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"@yot/schemas": fileURLToPath(new URL("../src/schemas", import.meta.url)),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:4010",
		},
	},
});
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
	"compilerOptions": {
		"target": "ESNext",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"strict": true,
		"jsx": "preserve",
		"verbatimModuleSyntax": true,
		"skipLibCheck": true,
		"noEmit": true,
		"lib": ["ESNext", "DOM", "DOM.Iterable"],
		"types": ["vite/client"],
		"paths": {
			"@/*": ["./src/*"],
			"@yot/schemas/*": ["../src/schemas/*"]
		}
	},
	"include": ["src/**/*.ts", "src/**/*.vue", "vite.config.ts"],
	"references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `web/tsconfig.node.json`**

```json
{
	"compilerOptions": {
		"composite": true,
		"module": "ESNext",
		"moduleResolution": "bundler",
		"skipLibCheck": true,
		"types": ["node"]
	},
	"include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Calendar</title>
	</head>
	<body>
		<div id="app"></div>
		<script type="module" src="/src/main.ts"></script>
	</body>
</html>
```

- [ ] **Step 6: Create `web/.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 7: Create `web/src/style.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 8: Create `web/src/main.ts`** (router/App added in later tasks; minimal mount now)

```ts
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./style.css";

createApp(App).use(router).mount("#app");
```

- [ ] **Step 9: Install dependencies**

Run: `npm --prefix web install`
Expected: completes without errors, creates `web/node_modules` and `web/package-lock.json`.

- [ ] **Step 10: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json web/tsconfig.node.json web/index.html web/.gitignore web/src/style.css web/src/main.ts
git commit -m "chore(web): scaffold Vue + Vite + Tailwind project"
```

---

## Task 9: API client

**Files:**
- Create: `web/src/api/client.ts`

- [ ] **Step 1: Write the client**

```ts
// web/src/api/client.ts
import type { Calendar } from "@yot/schemas/calendar.js";
import type { Event } from "@yot/schemas/event.js";
import type { Tag } from "@yot/schemas/tag.js";

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** Thin fetch wrapper. Auth is the HttpOnly cookie, so we just send credentials. */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const res = await fetch(`/api${path}`, {
		...options,
		credentials: "include",
		headers: { "content-type": "application/json", ...(options.headers ?? {}) },
	});
	if (res.status === 204) return undefined as T;
	const text = await res.text();
	const body = text ? JSON.parse(text) : null;
	if (!res.ok) {
		const message = body?.error?.message ?? res.statusText;
		throw new ApiError(res.status, message);
	}
	return body as T;
}

export const api = {
	session: () => request<{ scope: "read" | "write" }>("/auth/session"),
	pair: (pin: string) =>
		request<{ ok: true; scope: string }>("/auth/pair", {
			method: "POST",
			body: JSON.stringify({ pin }),
		}),
	logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

	listCalendars: () => request<Calendar[]>("/calendars"),
	createCalendar: (input: { name: string; color?: string }) =>
		request<Calendar>("/calendars", { method: "POST", body: JSON.stringify(input) }),
	deleteCalendar: (id: string) =>
		request<void>(`/calendars/${id}`, { method: "DELETE" }),

	listEvents: (query: Record<string, string> = {}) => {
		const qs = new URLSearchParams(query).toString();
		return request<Event[]>(`/events${qs ? `?${qs}` : ""}`);
	},
	createEvent: (input: {
		calendar_id: string;
		title: string;
		start_at: string;
		end_at: string;
		all_day?: boolean;
		location?: string;
		description?: string;
	}) => request<Event>("/events", { method: "POST", body: JSON.stringify(input) }),
	deleteEvent: (id: string) => request<void>(`/events/${id}`, { method: "DELETE" }),

	listTags: () => request<Tag[]>("/tags"),
};
```

> Note: `@yot/schemas/*.js` resolves through the tsconfig/vite alias to `../src/schemas/*`. Only `type` imports are used, so no backend runtime code is bundled.

- [ ] **Step 2: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat(web): add typed REST API client"
```

---

## Task 10: Composables (auth, calendars, events, tags, SSE)

**Files:**
- Create: `web/src/composables/useAuth.ts`, `useCalendars.ts`, `useEvents.ts`, `useTags.ts`, `useSSE.ts`

- [ ] **Step 1: `useAuth.ts`**

```ts
// web/src/composables/useAuth.ts
import { ref } from "vue";
import { api, ApiError } from "@/api/client";

const scope = ref<"read" | "write" | null>(null);
const checked = ref(false);

export function useAuth() {
	async function check(): Promise<boolean> {
		try {
			const s = await api.session();
			scope.value = s.scope;
			return true;
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) scope.value = null;
			return false;
		} finally {
			checked.value = true;
		}
	}

	async function pair(pin: string): Promise<void> {
		await api.pair(pin);
		await check();
	}

	async function logout(): Promise<void> {
		await api.logout();
		scope.value = null;
	}

	return { scope, checked, check, pair, logout };
}
```

- [ ] **Step 2: `useCalendars.ts`**

```ts
// web/src/composables/useCalendars.ts
import { ref } from "vue";
import type { Calendar } from "@yot/schemas/calendar.js";
import { api } from "@/api/client";

const calendars = ref<Calendar[]>([]);

export function useCalendars() {
	async function load() {
		calendars.value = await api.listCalendars();
	}
	async function create(name: string, color?: string) {
		await api.createCalendar({ name, ...(color ? { color } : {}) });
		await load();
	}
	async function remove(id: string) {
		await api.deleteCalendar(id);
		await load();
	}
	return { calendars, load, create, remove };
}
```

- [ ] **Step 3: `useEvents.ts`**

```ts
// web/src/composables/useEvents.ts
import { ref } from "vue";
import type { Event } from "@yot/schemas/event.js";
import { api } from "@/api/client";

const events = ref<Event[]>([]);

export function useEvents() {
	async function load(query: Record<string, string> = {}) {
		events.value = await api.listEvents(query);
	}
	async function create(input: {
		calendar_id: string;
		title: string;
		start_at: string;
		end_at: string;
		all_day?: boolean;
	}) {
		await api.createEvent(input);
		await load();
	}
	async function remove(id: string) {
		await api.deleteEvent(id);
		await load();
	}
	return { events, load, create, remove };
}
```

- [ ] **Step 4: `useTags.ts`**

```ts
// web/src/composables/useTags.ts
import { ref } from "vue";
import type { Tag } from "@yot/schemas/tag.js";
import { api } from "@/api/client";

const tags = ref<Tag[]>([]);

export function useTags() {
	async function load() {
		tags.value = await api.listTags();
	}
	return { tags, load };
}
```

- [ ] **Step 5: `useSSE.ts`**

```ts
// web/src/composables/useSSE.ts
import { onUnmounted, ref } from "vue";

const CHANGE_EVENTS = [
	"calendar.created",
	"calendar.updated",
	"calendar.deleted",
	"event.created",
	"event.updated",
	"event.deleted",
	"tag.created",
	"tag.deleted",
] as const;

/** Subscribe to /api/stream. `onChange` fires for any data-changing event. */
export function useSSE(onChange: () => void) {
	const connected = ref(false);
	let es: EventSource | null = null;
	let retry: ReturnType<typeof setTimeout> | null = null;

	function connect() {
		es = new EventSource("/api/stream", { withCredentials: true });
		es.addEventListener("ready", () => {
			connected.value = true;
		});
		es.onerror = () => {
			connected.value = false;
			es?.close();
			retry = setTimeout(connect, 2000); // auto-reconnect
		};
		for (const type of CHANGE_EVENTS) {
			es.addEventListener(type, () => onChange());
		}
	}

	function close() {
		if (retry) clearTimeout(retry);
		es?.close();
		connected.value = false;
	}

	connect();
	onUnmounted(close);
	return { connected };
}
```

> Note: `EventSource` sends same-origin cookies automatically; the `/api/stream` route reads `yot_session` via the cookie-aware middleware from Task 4.

- [ ] **Step 6: Commit**

```bash
git add web/src/composables
git commit -m "feat(web): add auth/data/SSE composables"
```

---

## Task 11: Router + App shell

**Files:**
- Create: `web/src/router.ts`, `web/src/App.vue`

- [ ] **Step 1: `web/src/router.ts`**

```ts
// web/src/router.ts
import { createRouter, createWebHistory } from "vue-router";
import { api, ApiError } from "@/api/client";

export const router = createRouter({
	history: createWebHistory(),
	routes: [
		{ path: "/", name: "calendar", component: () => import("@/views/CalendarView.vue") },
		{ path: "/list", name: "list", component: () => import("@/views/ListView.vue") },
		{ path: "/pair", name: "pair", component: () => import("@/views/PairView.vue") },
	],
});

// Guard: anything but /pair requires a valid session cookie.
router.beforeEach(async (to) => {
	if (to.name === "pair") return true;
	try {
		await api.session();
		return true;
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) return { name: "pair" };
		return true; // network error: let the view surface it
	}
});
```

- [ ] **Step 2: `web/src/App.vue`**

```vue
<script setup lang="ts">
import { useRoute } from "vue-router";
import { useAuth } from "@/composables/useAuth";

const route = useRoute();
const { logout } = useAuth();
</script>

<template>
	<div class="min-h-screen bg-gray-50 text-gray-900">
		<header
			v-if="route.name !== 'pair'"
			class="flex items-center gap-4 border-b bg-white px-4 py-3"
		>
			<h1 class="text-lg font-semibold">Calendar</h1>
			<nav class="flex gap-2">
				<RouterLink
					to="/"
					class="rounded px-3 py-1 hover:bg-gray-100"
					active-class="bg-gray-200"
					>Calendar</RouterLink
				>
				<RouterLink
					to="/list"
					class="rounded px-3 py-1 hover:bg-gray-100"
					active-class="bg-gray-200"
					>List</RouterLink
				>
			</nav>
			<button
				class="ml-auto rounded px-3 py-1 text-sm hover:bg-gray-100"
				@click="logout().then(() => $router.push('/pair'))"
			>
				Log out
			</button>
		</header>
		<main class="p-4">
			<RouterView />
		</main>
	</div>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/router.ts web/src/App.vue
git commit -m "feat(web): add router with auth guard and app shell"
```

---

## Task 12: PairView

**Files:**
- Create: `web/src/views/PairView.vue`

- [ ] **Step 1: Write the view**

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "@/composables/useAuth";

const pin = ref("");
const error = ref("");
const busy = ref(false);
const router = useRouter();
const { pair } = useAuth();

async function submit() {
	error.value = "";
	busy.value = true;
	try {
		await pair(pin.value.trim());
		router.push("/");
	} catch {
		error.value = "Invalid or expired PIN. Run `npm run auth` for a new one.";
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center bg-gray-50">
		<form
			class="w-80 space-y-4 rounded-lg border bg-white p-6 shadow-sm"
			@submit.prevent="submit"
		>
			<h1 class="text-center text-lg font-semibold">Pair this browser</h1>
			<p class="text-center text-sm text-gray-500">
				Run <code class="rounded bg-gray-100 px-1">npm run auth</code> and enter
				the PIN.
			</p>
			<input
				v-model="pin"
				inputmode="numeric"
				maxlength="6"
				placeholder="6-digit PIN"
				class="w-full rounded border px-3 py-2 text-center text-2xl tracking-widest"
			/>
			<p v-if="error" class="text-sm text-red-600">{{ error }}</p>
			<button
				type="submit"
				:disabled="busy || pin.length < 6"
				class="w-full rounded bg-blue-600 py-2 text-white disabled:opacity-50"
			>
				{{ busy ? "Pairing…" : "Pair" }}
			</button>
		</form>
	</div>
</template>
```

- [ ] **Step 2: Verify dev server + pairing end-to-end**

Run `npm run dev` (backend) and `npm --prefix web run dev` (frontend). Open `http://localhost:5173`. You should be redirected to `/pair`. Run `npm run auth`, enter the PIN.
Expected: redirect to `/` (CalendarView/ListView will be added next, so the route may 404 until Task 13 — that is fine; confirm the cookie is set and `/api/auth/session` returns 200 in the network tab).

- [ ] **Step 3: Commit**

```bash
git add web/src/views/PairView.vue
git commit -m "feat(web): add PIN pairing view"
```

---

## Task 13: CalendarView (Schedule-X), ListView, Sidebar, EventForm

**Files:**
- Create: `web/src/components/Sidebar.vue`, `web/src/components/EventForm.vue`, `web/src/views/CalendarView.vue`, `web/src/views/ListView.vue`

- [ ] **Step 1: `web/src/components/EventForm.vue`**

```vue
<script setup lang="ts">
import { reactive } from "vue";
import type { Calendar } from "@yot/schemas/calendar.js";

const props = defineProps<{ calendars: Calendar[] }>();
const emit = defineEmits<{
	submit: [
		input: {
			calendar_id: string;
			title: string;
			start_at: string;
			end_at: string;
		},
	];
}>();

const form = reactive({ calendar_id: "", title: "", start: "", end: "" });

function submit() {
	if (!form.calendar_id || !form.title || !form.start || !form.end) return;
	emit("submit", {
		calendar_id: form.calendar_id,
		title: form.title,
		start_at: new Date(form.start).toISOString(),
		end_at: new Date(form.end).toISOString(),
	});
	form.title = "";
	form.start = "";
	form.end = "";
}
</script>

<template>
	<form class="flex flex-wrap gap-2" @submit.prevent="submit">
		<select v-model="form.calendar_id" required class="rounded border px-2 py-1">
			<option value="" disabled>Calendar</option>
			<option v-for="c in props.calendars" :key="c.id" :value="c.id">
				{{ c.name }}
			</option>
		</select>
		<input v-model="form.title" placeholder="Title" required class="rounded border px-2 py-1" />
		<input v-model="form.start" type="datetime-local" required class="rounded border px-2 py-1" />
		<input v-model="form.end" type="datetime-local" required class="rounded border px-2 py-1" />
		<button class="rounded bg-blue-600 px-3 py-1 text-white">Add</button>
	</form>
</template>
```

- [ ] **Step 2: `web/src/components/Sidebar.vue`**

```vue
<script setup lang="ts">
import type { Calendar } from "@yot/schemas/calendar.js";

defineProps<{ calendars: Calendar[]; connected: boolean }>();
const emit = defineEmits<{ add: [name: string]; remove: [id: string] }>();

function addCalendar(e: Event) {
	const form = e.target as HTMLFormElement;
	const input = form.elements.namedItem("name") as HTMLInputElement;
	if (input.value.trim()) emit("add", input.value.trim());
	form.reset();
}
</script>

<template>
	<aside class="w-56 shrink-0 space-y-3">
		<div class="flex items-center gap-2 text-sm">
			<span
				class="inline-block h-2 w-2 rounded-full"
				:class="connected ? 'bg-green-500' : 'bg-red-500'"
			/>
			<span class="text-gray-500">{{ connected ? "Live" : "Offline" }}</span>
		</div>
		<h2 class="text-sm font-semibold text-gray-500">Calendars</h2>
		<ul class="space-y-1">
			<li
				v-for="c in calendars"
				:key="c.id"
				class="flex items-center justify-between rounded px-2 py-1 hover:bg-gray-100"
			>
				<span class="flex items-center gap-2">
					<span
						class="inline-block h-3 w-3 rounded-full"
						:style="{ background: c.color ?? '#999' }"
					/>
					{{ c.name }}
				</span>
				<button class="text-xs text-red-600" @click="emit('remove', c.id)">×</button>
			</li>
		</ul>
		<form class="flex gap-1" @submit.prevent="addCalendar">
			<input name="name" placeholder="New calendar" class="w-full rounded border px-2 py-1 text-sm" />
			<button class="rounded bg-gray-200 px-2 text-sm">+</button>
		</form>
	</aside>
</template>
```

- [ ] **Step 3: `web/src/views/CalendarView.vue`** (Schedule-X integration, confirmed v3 API)

```vue
<script setup lang="ts">
import {
	createCalendar,
	createViewDay,
	createViewMonthGrid,
	createViewWeek,
} from "@schedule-x/calendar";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { ScheduleXCalendar } from "@schedule-x/vue";
import "@schedule-x/theme-default/dist/index.css";
import { onMounted } from "vue";
import type { Event } from "@yot/schemas/event.js";
import Sidebar from "@/components/Sidebar.vue";
import EventForm from "@/components/EventForm.vue";
import { useCalendars } from "@/composables/useCalendars";
import { useEvents } from "@/composables/useEvents";
import { useSSE } from "@/composables/useSSE";

const { calendars, load: loadCals, create: addCal, remove: delCal } = useCalendars();
const { events, load: loadEvents, create: addEvent } = useEvents();

const eventsService = createEventsServicePlugin();
const calendarApp = createCalendar({
	views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
	events: [],
	plugins: [eventsService],
});

// Schedule-X wants "YYYY-MM-DD HH:mm" (local) or "YYYY-MM-DD" for all-day.
function toSx(iso: string, allDay: boolean): string {
	const d = new Date(iso);
	const p = (n: number) => String(n).padStart(2, "0");
	const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	return allDay ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function syncCalendar(list: Event[]) {
	eventsService.set(
		list.map((e) => ({
			id: e.id,
			title: e.title,
			start: toSx(e.start_at, e.all_day),
			end: toSx(e.end_at, e.all_day),
		})),
	);
}

async function refresh() {
	await Promise.all([loadCals(), loadEvents()]);
	syncCalendar(events.value);
}

const { connected } = useSSE(refresh);
onMounted(refresh);
</script>

<template>
	<div class="flex gap-4">
		<Sidebar
			:calendars="calendars"
			:connected="connected"
			@add="(name) => addCal(name)"
			@remove="(id) => delCal(id)"
		/>
		<div class="min-w-0 flex-1 space-y-3">
			<EventForm :calendars="calendars" @submit="(input) => addEvent(input)" />
			<ScheduleXCalendar :calendar-app="calendarApp" />
		</div>
	</div>
</template>
```

- [ ] **Step 4: `web/src/views/ListView.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import Sidebar from "@/components/Sidebar.vue";
import EventForm from "@/components/EventForm.vue";
import { useCalendars } from "@/composables/useCalendars";
import { useEvents } from "@/composables/useEvents";
import { useSSE } from "@/composables/useSSE";

const { calendars, load: loadCals, create: addCal, remove: delCal } = useCalendars();
const { events, load: loadEvents, create: addEvent, remove: delEvent } = useEvents();
const search = ref("");

async function refresh() {
	await Promise.all([loadCals(), loadEvents(search.value ? { q: search.value } : {})]);
}

const { connected } = useSSE(refresh);
onMounted(refresh);
</script>

<template>
	<div class="flex gap-4">
		<Sidebar
			:calendars="calendars"
			:connected="connected"
			@add="(name) => addCal(name)"
			@remove="(id) => delCal(id)"
		/>
		<div class="min-w-0 flex-1 space-y-3">
			<div class="flex gap-2">
				<input
					v-model="search"
					placeholder="Search…"
					class="rounded border px-2 py-1"
					@keyup.enter="refresh"
				/>
				<button class="rounded bg-gray-200 px-3 py-1" @click="refresh">Search</button>
			</div>
			<EventForm :calendars="calendars" @submit="(input) => addEvent(input)" />
			<ul class="divide-y rounded border bg-white">
				<li
					v-for="e in events"
					:key="e.id"
					class="flex items-center justify-between px-3 py-2"
				>
					<span>
						<span class="font-medium">{{ e.title }}</span>
						<span class="ml-2 text-sm text-gray-500">
							{{ new Date(e.start_at).toLocaleString() }}
						</span>
					</span>
					<button class="text-sm text-red-600" @click="delEvent(e.id)">Delete</button>
				</li>
				<li v-if="events.length === 0" class="px-3 py-2 text-sm text-gray-400">
					No events.
				</li>
			</ul>
		</div>
	</div>
</template>
```

- [ ] **Step 5: Verify end-to-end in dev**

With backend (`npm run dev`) and frontend (`npm --prefix web run dev`) running and paired:
- CalendarView shows the Schedule-X month grid; adding an event via the form makes it appear (SSE refresh).
- ListView lists events; search filters; delete removes an event and the list updates live.
- Stopping the backend flips the Sidebar indicator to "Offline"; restarting reconnects.

- [ ] **Step 6: Commit**

```bash
git add web/src/components web/src/views/CalendarView.vue web/src/views/ListView.vue
git commit -m "feat(web): add calendar/list views, sidebar, event form"
```

---

## Task 14: Production build wiring

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add root scripts**

In the root `package.json` `scripts`, add:

```json
		"web:dev": "npm --prefix web run dev",
		"web:build": "npm --prefix web run build",
```

and change `build` to also build the web app:

```json
		"build": "tsc && npm --prefix web run build",
```

- [ ] **Step 2: Build everything**

Run: `npm run build`
Expected: backend compiles to `dist/`, frontend builds to `web/dist/` (contains `index.html` + `assets/`).

- [ ] **Step 3: Verify production serving**

Run: `npm start`. Open `http://localhost:4010/`.
Expected: the SPA loads (redirects to `/pair` when unpaired); after `npm run auth` + PIN, the calendar app works same-origin (no proxy). Refreshing on `/list` still loads (SPA fallback).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: wire web build into root build + add web scripts"
```

---

## Task 15: Final verification

- [ ] **Step 1: Full backend test suite**

Run: `npm test`
Expected: all tests pass (existing + `PairingService`, `RateLimiter`, `auth pairing`).

- [ ] **Step 2: Format/lint**

Run: `npm run format`
Expected: Biome reports clean (or auto-fixes); re-run to confirm no diffs.

- [ ] **Step 3: Type-check the frontend**

Run: `npm --prefix web run build`
Expected: `vue-tsc` reports no errors.

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: format and final cleanup"
```

---

## Self-Review Notes (for the implementer)

- **Schedule-X version:** Plan pins `@schedule-x/*` to `^3.34.0` (confirmed API: `createCalendar`, `createViewMonthGrid/Week/Day`, `createEventsServicePlugin().set()`, `<ScheduleXCalendar :calendar-app>`). If `npm install` resolves a different major, re-check the events-service `.set()` signature.
- **Schema alias imports** use `@yot/schemas/<file>.js` and only `import type`, so no backend runtime is bundled and no `.js`/ESM resolution issue arises at build time.
- **Middleware order** in Task 5 is load-bearing: `pair`/`logout` before `authenticate`, `pin`/`session` between `authenticate` and `requireWriteForMutations`.
- **Biome** governs `.` — frontend files under `web/` are included by `npm run format`; if Biome flags Vue SFCs it does not parse, scope formatting to `src/`/`scripts/` instead.
