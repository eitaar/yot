import { z } from "@hono/zod-openapi";

export const TagSchema = z
	.object({
		id: z.string(),
		name: z.string().openapi({ example: "important" }),
		color: z.string().nullable().openapi({ example: "#ef4444" }),
	})
	.openapi("Tag");

export const CreateTagSchema = z
	.object({
		name: z.string().min(1).openapi({ example: "important" }),
		color: z.string().optional().openapi({ example: "#ef4444" }),
	})
	.openapi("CreateTag");

export type Tag = z.infer<typeof TagSchema>;
export type CreateTagInput = z.infer<typeof CreateTagSchema>;
