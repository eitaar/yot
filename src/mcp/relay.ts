import type { EventBus } from "../core/event-bus.js";

export interface RelayOptions {
	url: string;
	apiKey: string;
	fetchImpl?: typeof fetch;
}

/**
 * Subscribe to the MCP process's event bus and POST each change to the HTTP
 * server's internal relay endpoint. Fire-and-forget: a failed POST is logged
 * to stderr but never propagates into the tool call.
 *
 * Returns an unsubscribe function.
 */
export function startChangeRelay(
	bus: EventBus,
	opts: RelayOptions,
): () => void {
	const { url, apiKey, fetchImpl = fetch } = opts;

	return bus.subscribe((ev) => {
		fetchImpl(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ type: ev.type, data: ev.data }),
		}).catch((err) => {
			console.error("[relay] failed to forward change:", err);
		});
	});
}
