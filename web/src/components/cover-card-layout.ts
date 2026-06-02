export type CoverTier = "hero" | "feature" | "normal";

export type CoverCardLayout = {
	tier: CoverTier;
	// Kept as two flags (not one `showMeta`) so a tier can later show the
	// calendar chip without the location, or vice versa; today they coincide.
	showCalendar: boolean;
	showLocation: boolean;
};

export type CoverEvent = {
	id: string;
	image_path: string | null;
	description: string | null;
	location: string | null;
	url: string | null;
	tags: string[];
};

/**
 * How much an event has to "say". A cover face is image-forward, so a photo is
 * the strongest signal, with text fields adding supporting weight.
 */
export function richness(e: CoverEvent): number {
	let s = 0;
	if (e.image_path) s += 2;
	if (e.description) s += 1;
	if (e.location) s += 1;
	if (e.tags.length > 0) s += 1;
	if (e.url) s += 1;
	return s;
}

// Promote ~half of eligible events (jitter decides which), and never two big
// cards within MIN_GAP of each other. Tuned so the layout reads organic, not
// mechanical, and stays stable across re-renders (jitter is a pure fn of id).
const PROMOTE_THRESHOLD = 0.5;
const MIN_GAP = 2;

/** Stable hash of an id mapped to [0, 1). FNV-1a over char codes. */
function jitter(id: string): number {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return ((h >>> 0) % 1000) / 1000;
}

/**
 * Assign each upcoming event (already ordered soonest-first) a tier:
 * - index 0 is always the `hero`.
 * - an image-backed, information-rich event (richness >= 3) is promoted to
 *   `feature` when its jitter passes the threshold AND at least MIN_GAP normal
 *   cards have passed since the last big card.
 * - everything else is `normal`.
 */
export function coverCardLayouts(events: CoverEvent[]): CoverCardLayout[] {
	let sinceFeature = 0;
	return events.map((e, index) => {
		if (index === 0) {
			// The hero opens the run; the gap counter already starts at 0.
			return { tier: "hero", showCalendar: true, showLocation: true };
		}
		const eligible = Boolean(e.image_path) && richness(e) >= 3;
		if (
			eligible &&
			sinceFeature >= MIN_GAP &&
			jitter(e.id) < PROMOTE_THRESHOLD
		) {
			sinceFeature = 0;
			return { tier: "feature", showCalendar: true, showLocation: true };
		}
		sinceFeature++;
		return { tier: "normal", showCalendar: false, showLocation: false };
	});
}
