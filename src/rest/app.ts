import { OpenAPIHono } from "@hono/zod-openapi";
import type { ErrorHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
	type AuthEnv,
	authenticate,
	requireWriteForMutations,
} from "../auth/middleware.js";
import { AppError, ValidationError } from "../core/errors.js";
import type { EventBus } from "../core/event-bus.js";
import type { Services } from "../services/container.js";
import { registerAuthedAuthRoutes, registerPublicAuthRoutes } from "./auth.js";
import { registerCalendarRoutes } from "./calendars.js";
import { registerEventRoutes } from "./events.js";
import { registerImportRoutes } from "./import.js";
import { registerInternalRoutes } from "./internal.js";
import { registerStreamRoute } from "./stream.js";
import { registerTagRoutes } from "./tags.js";
import { registerUploadRoutes } from "./uploads.js";

const errorHandler: ErrorHandler = (err, c) => {
	if (err instanceof AppError) {
		if (err.status === 401) {
			c.header("WWW-Authenticate", 'Bearer realm="yot"');
		}
		const body = {
			error: {
				code: err.code,
				message: err.message,
				...(err instanceof ValidationError && err.details
					? { details: err.details }
					: {}),
			},
		};
		return c.json(body, err.status as ContentfulStatusCode);
	}
	console.error(err);
	return c.json(
		{ error: { code: "internal_error", message: "Internal server error" } },
		500,
	);
};

const SWAGGER_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Calendar API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => SwaggerUIBundle({ url: "/api/doc", dom_id: "#swagger-ui" });
    </script>
  </body>
</html>`;

/**
 * Build the full HTTP app rooted at `/api`. Public endpoints (health, OpenAPI
 * doc, Swagger UI) come first; everything after the auth middleware requires a
 * valid API key, and mutations require a write-scoped key.
 */
export function buildApp({
	bus,
	services,
	logging = false,
}: {
	bus: EventBus;
	services: Services;
	logging?: boolean;
}): OpenAPIHono<AuthEnv> {
	// Turn validation failures into a uniform ValidationError (caught by onError).
	const api = new OpenAPIHono<AuthEnv>({
		defaultHook: (result) => {
			if (!result.success) {
				throw new ValidationError(
					"Request validation failed",
					result.error.issues,
				);
			}
		},
	});

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
	registerAuthedAuthRoutes(api, services);
	api.use("*", requireWriteForMutations());

	// --- protected ---
	registerCalendarRoutes(api, services);
	registerEventRoutes(api, services);
	registerUploadRoutes(api, services);
	registerImportRoutes(api, services);
	registerTagRoutes(api, services);
	registerStreamRoute(api, bus);
	registerInternalRoutes(api, bus);

	const app = new OpenAPIHono<AuthEnv>();
	// Global middleware must be registered before the routes it should wrap.
	if (logging) app.use("*", logger());
	app.use("*", cors());
	app.use("*", secureHeaders());
	app.onError(errorHandler);
	app.route("/api", api);
	return app;
}
