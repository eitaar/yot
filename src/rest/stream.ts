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
	api.get("/stream", (c) =>
		streamSSE(c, async (stream) => {
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

			await stream.writeSSE({ event: "ready", data: "connected" });

			// Hold the connection open until the client disconnects.
			await new Promise<void>((resolve) => stream.onAbort(resolve));
			clearInterval(heartbeat);
			unsubscribe();
		}),
	);
}
