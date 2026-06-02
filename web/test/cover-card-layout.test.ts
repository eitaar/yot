import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	type CoverEvent,
	coverCardLayouts,
	richness,
} from "../src/components/cover-card-layout";

function event(overrides: Partial<CoverEvent> = {}): CoverEvent {
	return {
		id: overrides.id ?? "id",
		image_path: overrides.image_path ?? null,
		description: overrides.description ?? null,
		location: overrides.location ?? null,
		url: overrides.url ?? null,
		tags: overrides.tags ?? [],
	};
}

describe("richness", () => {
	test("sums field weights (image worth 2)", () => {
		assert.equal(richness(event()), 0);
		assert.equal(richness(event({ image_path: "/i.jpg" })), 2);
		assert.equal(richness(event({ description: "d" })), 1);
		assert.equal(richness(event({ location: "l" })), 1);
		assert.equal(richness(event({ tags: ["t"] })), 1);
		assert.equal(richness(event({ url: "u" })), 1);
		assert.equal(
			richness(
				event({
					image_path: "/i.jpg",
					description: "d",
					location: "l",
					tags: ["t"],
					url: "u",
				}),
			),
			6,
		);
	});
});

describe("coverCardLayouts", () => {
	const eligible = (id: string) =>
		event({ id, image_path: "/i.jpg", description: "d" }); // richness 3

	test("the first event is always the hero", () => {
		const out = coverCardLayouts([
			event({ id: "0" }),
			eligible("a"),
			eligible("b"),
		]);
		assert.equal(out[0].tier, "hero");
	});

	test("an event without an image is never a feature", () => {
		const events = [event({ id: "0" })].concat(
			Array.from({ length: 8 }, (_, i) =>
				event({
					id: `n${i}`,
					description: "d",
					location: "l",
					tags: ["t"],
					url: "u",
				}),
			),
		);
		const out = coverCardLayouts(events);
		assert.ok(out.slice(1).every((l) => l.tier !== "feature"));
	});

	test("a low-richness event (score < 3) is never a feature", () => {
		const events = [event({ id: "0" })].concat(
			Array.from({ length: 8 }, (_, i) =>
				event({ id: `n${i}`, image_path: "/i.jpg" }),
			), // richness 2
		);
		const out = coverCardLayouts(events);
		assert.ok(out.slice(1).every((l) => l.tier !== "feature"));
	});

	test("features are never adjacent (gap of >= 2 normals)", () => {
		const events = [event({ id: "0" })].concat(
			Array.from({ length: 20 }, (_, i) => eligible(`e${i}`)),
		);
		const out = coverCardLayouts(events);
		const idx = out.flatMap((l, i) => (l.tier === "feature" ? [i] : []));
		// MIN_GAP=2 normals between features => their indices differ by >= 3.
		for (let i = 1; i < idx.length; i++) {
			assert.ok(idx[i] - idx[i - 1] >= 3, `features too close: ${idx}`);
		}
	});

	test("layout is deterministic for the same ids", () => {
		const make = () =>
			[event({ id: "0" })].concat(
				Array.from({ length: 20 }, (_, i) => eligible(`e${i}`)),
			);
		const a = coverCardLayouts(make()).map((l) => l.tier);
		const b = coverCardLayouts(make()).map((l) => l.tier);
		assert.deepEqual(a, b);
	});

	test("not every eligible event is promoted (jitter breaks the cadence)", () => {
		const events = [event({ id: "0" })].concat(
			Array.from({ length: 20 }, (_, i) => eligible(`e${i}`)),
		);
		const out = coverCardLayouts(events);
		const features = out.filter((l) => l.tier === "feature").length;
		assert.ok(features > 0, "expected some features");
		assert.ok(features < 20, "expected jitter/spacing to hold some back");
	});
});
