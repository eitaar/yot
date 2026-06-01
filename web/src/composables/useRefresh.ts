/**
 * Wrap an async refresh so overlapping calls collapse into a single in-flight
 * run. Calls made while a run is active are coalesced and trigger exactly one
 * trailing re-run after it finishes, so the result still reflects the latest
 * state. This removes the redundant fetches that fire when a mutation's own
 * refresh races the SSE broadcast it provokes (and during SSE bursts).
 *
 * No artificial delay is added: the first caller starts immediately and its
 * returned promise resolves when the data is actually fresh, so callers can
 * still `await` before, e.g., closing a modal.
 */
export function coalesce(run: () => Promise<void>): () => Promise<void> {
	let inFlight: Promise<void> | null = null;
	let queued = false;

	return function trigger(): Promise<void> {
		if (inFlight) {
			queued = true;
			return inFlight;
		}
		inFlight = (async () => {
			try {
				do {
					queued = false;
					await run();
				} while (queued);
			} finally {
				inFlight = null;
			}
		})();
		return inFlight;
	};
}
