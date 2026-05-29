import { randomUUID } from "node:crypto";

/** Generate a new random uuid (v4). */
export function newId(): string {
	return randomUUID();
}

/** Current timestamp as ISO-8601 UTC text — the storage format for all dates. */
export function now(): string {
	return new Date().toISOString();
}
