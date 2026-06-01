import { z } from "@hono/zod-openapi";

/**
 * A permissive ISO-8601 date/time string: anything `Date.parse` accepts,
 * which covers full timestamps and date-only (all-day) values. Storage is
 * always the string as provided; see core/id.ts for server-generated stamps.
 */
export function isoDateTime(example = "2026-05-29T10:00:00.000Z") {
	return z
		.string()
		.refine(
			(v) => !Number.isNaN(Date.parse(v)),
			"must be a valid ISO-8601 date/time",
		)
		.openapi({ format: "date-time", example });
}

/**
 * True only for http(s) URLs. Used to keep dangerous schemes (`javascript:`,
 * `data:`, etc.) out of stored event links, which would otherwise be an XSS
 * vector when rendered into an `<a href>`.
 */
export function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}
