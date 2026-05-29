/** A change broadcast over the realtime feed. */
export type ChangeEvent = {
	type: string;
	data: unknown;
};

export type ChangeListener = (event: ChangeEvent) => void;

/**
 * In-process publish/subscribe bus. Services emit change events here on every
 * successful mutation; the SSE endpoint subscribes and forwards to clients.
 */
export class EventBus {
	private readonly listeners = new Set<ChangeListener>();

	/** Register a listener. Returns a function that unsubscribes it. */
	subscribe(listener: ChangeListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Broadcast an event to all current listeners. */
	emit(event: ChangeEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
