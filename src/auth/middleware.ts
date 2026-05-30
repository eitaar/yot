import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { ForbiddenError, UnauthorizedError } from "../core/errors.js";
import type { ApiKey, ApiKeyService, Scope } from "./apikey.js";

/** Hono environment: an authenticated request carries the resolved API key. */
export type AuthEnv = { Variables: { apiKey: ApiKey } };

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

/** Validate the API key, record usage, and stash it on the context. */
export function authenticate(
	apiKeys: ApiKeyService,
): MiddlewareHandler<AuthEnv> {
	return async (c, next) => {
		const raw = extractRawKey(c);
		if (!raw) throw new UnauthorizedError("Missing API key");
		const key = apiKeys.findByRawKey(raw);
		if (!key) throw new UnauthorizedError("Invalid API key");
		apiKeys.touch(key.id);
		c.set("apiKey", key);
		await next();
	};
}

/** Reject mutating REST methods when the authenticated key is read-only. */
export function requireWriteForMutations(): MiddlewareHandler<AuthEnv> {
	return async (c, next) => {
		const method = c.req.method.toUpperCase();
		const isRead =
			method === "GET" || method === "HEAD" || method === "OPTIONS";
		if (!isRead && c.get("apiKey").scope === "read") {
			throw new ForbiddenError("This API key is read-only");
		}
		await next();
	};
}

/** Enforce a required scope explicitly (used by MCP write tools). */
export function assertScope(key: ApiKey, required: Scope): void {
	if (required === "write" && key.scope !== "write") {
		throw new ForbiddenError("This API key is read-only");
	}
}
