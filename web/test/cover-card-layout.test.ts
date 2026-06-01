import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coverCardLayout } from "../src/components/cover-card-layout";

type TestEvent = {
	id: string;
	title: string;
	start_at: string;
	end_at: string;
	all_day: boolean;
	description: string | null;
	location: string | null;
	url: string | null;
	image_path: string | null;
	tags: string[];
};

function event(overrides: Partial<TestEvent> = {}): TestEvent {
	return {
		id: overrides.id ?? "event-id",
		title: overrides.title ?? "Event",
		start_at: overrides.start_at ?? "2026-06-01T10:00:00.000Z",
		end_at: overrides.end_at ?? "2026-06-01T11:00:00.000Z",
		all_day: overrides.all_day ?? false,
		description: overrides.description ?? null,
		location: overrides.location ?? null,
		url: overrides.url ?? null,
		image_path: overrides.image_path ?? null,
		tags: overrides.tags ?? [],
	};
}

describe("coverCardLayout", () => {
	test("makes the first upcoming event the large feature card", () => {
		const layout = coverCardLayout(event({ description: "short" }), 0);

		assert.equal(layout.importance, "feature");
		assert.match(layout.className, /sm:col-span-2/);
		assert.match(layout.className, /sm:row-span-2/);
		assert.equal(layout.showDetails, true);
	});

	test("uses medium cards for events with richer information", () => {
		const layout = coverCardLayout(
			event({ location: "Studio", tags: ["design"], image_path: "cover.jpg" }),
			2,
		);

		assert.equal(layout.importance, "standard");
		assert.match(layout.className, /sm:col-span-2/);
		assert.doesNotMatch(layout.className, /sm:row-span-2/);
		assert.equal(layout.showDetails, true);
	});

	test("keeps low-information events compact", () => {
		const layout = coverCardLayout(event(), 4);

		assert.equal(layout.importance, "compact");
		assert.doesNotMatch(layout.className, /sm:col-span-2/);
		assert.equal(layout.showDetails, false);
	});
});
