type CoverEvent = {
	all_day: boolean;
	description: string | null;
	image_path: string | null;
	location: string | null;
	tags: string[];
	url: string | null;
};

export type CoverCardImportance = "feature" | "standard" | "compact";

export type CoverCardLayout = {
	className: string;
	importance: CoverCardImportance;
	showDetails: boolean;
};

function informationScore(event: CoverEvent): number {
	let score = 0;
	if (event.image_path) score += 2;
	if (event.location) score += 1;
	if (event.description) score += 1;
	if (event.url) score += 1;
	if (event.tags.length) score += 1;
	if (event.all_day) score += 1;
	return score;
}

export function coverCardLayout(
	event: CoverEvent,
	index: number,
): CoverCardLayout {
	if (index === 0) {
		return {
			className: "col-span-2 row-span-2 min-h-72 sm:col-span-2 sm:row-span-2",
			importance: "feature",
			showDetails: true,
		};
	}

	if (informationScore(event) >= 2 || index % 5 === 3) {
		return {
			className: "col-span-2 min-h-36 sm:col-span-2",
			importance: "standard",
			showDetails: true,
		};
	}

	return {
		className: "min-h-36",
		importance: "compact",
		showDetails: false,
	};
}
