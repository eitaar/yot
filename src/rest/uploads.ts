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
		return c.body(new Uint8Array(bytes));
	});
}
