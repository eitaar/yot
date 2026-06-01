import type { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import type { AuthEnv } from "../auth/middleware.js";
import type { EventBus } from "../core/event-bus.js";

const HEARTBEAT_MS = 25_000;

/**
 * `GET /stream` — Server-Sent Events feed of every change emitted on the bus.
 * Each frame uses the change type as the SSE event name and JSON data, e.g.
 *   event: event.created
 *   data: {"id":"...","title":"..."}
 * A periodic `ping` keeps idle connections alive. The connection stays open
 * until the client disconnects.
 */
export function registerStreamRoute(
	api: OpenAPIHono<AuthEnv>,
	bus: EventBus,
): void {
	api.get("/stream", (c) => {
		const res = streamSSE(c, async (stream) => {
			const unsubscribe = bus.subscribe((ev) => {
				void stream
					.writeSSE({ event: ev.type, data: JSON.stringify(ev.data) })
					.catch(() => {});
			});
			const heartbeat = setInterval(() => {
				void stream
					.writeSSE({ event: "ping", data: String(Date.now()) })
					.catch(() => {});
			}, HEARTBEAT_MS);
			// Don't let the heartbeat timer keep the process alive on its own.
			heartbeat.unref?.();

			// A padded comment as the very first bytes defeats byte-threshold
			// buffering in some proxies/tunnels, forcing an immediate flush so the
			// browser's EventSource fires `open` and the "ready" event lands.
			await stream.write(`:${" ".repeat(2048)}\n\n`);
			await stream.writeSSE({ event: "ready", data: "connected" });

			// Hold the connection open until the client disconnects.
			await new Promise<void>((resolve) => stream.onAbort(resolve));
			clearInterval(heartbeat);
			unsubscribe();
		});
		// Disable proxy buffering so events flush immediately. Without these,
		// reverse proxies / tunnels (Cloudflare, cloudflared, nginx) buffer the
		// long-lived response and the stream looks dead even though it works on
		// localhost. Set via c.header AFTER streamSSE so the Cache-Control here
		// overrides the no-cache it sets (the final headers come from c's map).
		c.header("X-Accel-Buffering", "no");
		c.header("Cache-Control", "no-cache, no-transform");
		return res;
	});
}
