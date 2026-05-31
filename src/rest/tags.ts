import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthEnv } from "../auth/middleware.js";
import { CreateTagSchema, TagSchema, UpdateTagSchema } from "../schemas/tag.js";
import type { Services } from "../services/container.js";

const IdParam = z.object({ id: z.string() });
const tags = ["tags"];
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({
	content: { "application/json": { schema } },
});

export function registerTagRoutes(
	api: OpenAPIHono<AuthEnv>,
	{ tags: tagSvc }: Services,
): void {
	api.openapi(
		createRoute({
			method: "get",
			path: "/tags",
			tags,
			responses: {
				200: { description: "All tags", ...jsonBody(z.array(TagSchema)) },
			},
		}),
		(c) => c.json(tagSvc.list(), 200),
	);

	api.openapi(
		createRoute({
			method: "post",
			path: "/tags",
			tags,
			request: { body: jsonBody(CreateTagSchema) },
			responses: {
				201: { description: "Created", ...jsonBody(TagSchema) },
				409: { description: "Name already exists" },
			},
		}),
		(c) => c.json(tagSvc.create(c.req.valid("json")), 201),
	);

	api.openapi(
		createRoute({
			method: "patch",
			path: "/tags/{id}",
			tags,
			request: { params: IdParam, body: jsonBody(UpdateTagSchema) },
			responses: {
				200: { description: "Updated", ...jsonBody(TagSchema) },
				404: { description: "Not found" },
				409: { description: "Name already exists" },
			},
		}),
		(c) =>
			c.json(tagSvc.update(c.req.valid("param").id, c.req.valid("json")), 200),
	);

	api.openapi(
		createRoute({
			method: "delete",
			path: "/tags/{id}",
			tags,
			request: { params: IdParam },
			responses: {
				204: { description: "Deleted" },
				404: { description: "Not found" },
			},
		}),
		(c) => {
			tagSvc.delete(c.req.valid("param").id);
			return c.body(null, 204);
		},
	);
}
