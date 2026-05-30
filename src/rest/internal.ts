import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import type { AuthEnv } from "../auth/middleware.js";
import { ValidationError } from "../core/errors.js";
import type { EventBus } from "../core/event-bus.js";

const InternalEventBody = z.object({
	type: z.string().regex(/^[a-z]+\.[a-z]+$/),
	data: z.unknown(),
});

/**
 * Internal relay endpoint — accepts change events from the MCP process and
 * replays them onto the HTTP server's event bus for SSE fan-out.
 */
export function registerInternalRoutes(
	api: OpenAPIHono<AuthEnv>,
	bus: EventBus,
): void {
	api.post("/internal/events", async (c) => {
		const result = InternalEventBody.safeParse(await c.req.json());
		if (!result.success) {
			throw new ValidationError("Invalid event body", result.error.issues);
		}
		bus.emit({ type: result.data.type, data: result.data.data });
		return c.body(null, 204);
	});
}
