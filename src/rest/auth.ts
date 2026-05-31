import { getConnInfo } from "@hono/node-server/conninfo";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthEnv } from "../auth/middleware.js";
import { RateLimiter } from "../auth/rate-limit.js";
import { UnauthorizedError } from "../core/errors.js";
import type { Services } from "../services/container.js";

const COOKIE = "yot_session";
const MAX_AGE_S = 60 * 60 * 24 * 400;

function clientIp(c: Context<AuthEnv>): string {
	try {
		return getConnInfo(c).remote.address ?? "unknown";
	} catch {
		return "unknown";
	}
}

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
			maxAge: MAX_AGE_S,
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

export function registerAuthedAuthRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ pairing }: Services,
): void {
	api.post("/auth/pin", async (c) => {
		const caller = c.get("apiKey");
		const body = (await c.req.json().catch(() => ({}))) as { scope?: unknown };
		const requested = body.scope === "read" ? "read" : "write";
		const scope = caller.scope === "read" ? "read" : requested;
		const pin = pairing.createPin(scope);
		return c.json({ pin, scope, expires_in: 300 }, 200);
	});

	api.get("/auth/session", (c) => {
		return c.json({ scope: c.get("apiKey").scope }, 200);
	});
}
