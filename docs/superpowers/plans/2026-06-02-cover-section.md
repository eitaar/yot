# Cover Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the cover view as an editorial landscape mosaic — soonest event as a hero, information-rich events promoted to larger cards via a richness + per-event-jitter rule, a uniform dark mask over each image, borderless.

**Architecture:** A pure, unit-tested module (`cover-card-layout.ts`) decides each card's tier (`hero` / `feature` / `normal`) and what detail to show; a thin presentational component (`CoverGrid.vue`) maps tiers to Tailwind grid spans and renders the tiles. The `/cover` route, `ListView` cover branch, and nav links (removed in commit `f6f3ac4`) are restored.

**Tech Stack:** Vue 3 `<script setup>`, Tailwind v4, daisyui 5, lucide icons, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-06-02-cover-section-design.md`

---

## File Structure

- **Create** `web/src/components/cover-card-layout.ts` — pure layout/importance logic (`richness`, `coverCardLayouts`). No Vue imports.
- **Create** `web/test/cover-card-layout.test.ts` — `node:test` unit tests for the logic.
- **Create** `web/src/components/CoverGrid.vue` — presentational grid; consumes the logic, renders tiles, emits `open`.
- **Modify** `web/src/router.ts` — restore the `/cover` route.
- **Modify** `web/src/views/ListView.vue` — restore the `coverMode` branch (render `CoverGrid` on the cover route, else `AgendaList`).
- **Modify** `web/src/App.vue` — restore the desktop "Cover" nav link.
- **Modify** `web/src/components/BottomDock.vue` — restore the mobile "Cover" nav link.

Test runner: `npx tsx --test web/test/cover-card-layout.test.ts` (run from the repo root). This matches the existing `node:test`/`tsx` setup; the test imports the logic by relative path, so no path alias is involved.

---

## Task 1: Card layout + importance logic (TDD)

**Files:**
- Create: `web/src/components/cover-card-layout.ts`
- Test: `web/test/cover-card-layout.test.ts`

- [ ] **Step 1: Write the failing `richness` test**

Create `web/test/cover-card-layout.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coverCardLayouts, richness } from "../src/components/cover-card-layout";

type TestEvent = {
	id: string;
	image_path: string | null;
	description: string | null;
	location: string | null;
	url: string | null;
	tags: string[];
};

function event(overrides: Partial<TestEvent> = {}): TestEvent {
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
			richness(event({ image_path: "/i.jpg", description: "d", location: "l", tags: ["t"], url: "u" })),
			6,
		);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test web/test/cover-card-layout.test.ts`
Expected: FAIL — cannot find module `../src/components/cover-card-layout`.

- [ ] **Step 3: Implement `richness` (+ types)**

Create `web/src/components/cover-card-layout.ts`:

```ts
export type CoverTier = "hero" | "feature" | "normal";

export type CoverCardLayout = {
	tier: CoverTier;
	showCalendar: boolean;
	showLocation: boolean;
};

type CoverEvent = {
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test web/test/cover-card-layout.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add the failing `coverCardLayouts` tests**

Append to `web/test/cover-card-layout.test.ts`:

```ts
describe("coverCardLayouts", () => {
	const eligible = (id: string) => event({ id, image_path: "/i.jpg", description: "d" }); // richness 3

	test("the first event is always the hero", () => {
		const out = coverCardLayouts([event({ id: "0" }), eligible("a"), eligible("b")]);
		assert.equal(out[0].tier, "hero");
	});

	test("an event without an image is never a feature", () => {
		const events = [event({ id: "0" })].concat(
			Array.from({ length: 8 }, (_, i) =>
				event({ id: `n${i}`, description: "d", location: "l", tags: ["t"], url: "u" })),
		);
		const out = coverCardLayouts(events);
		assert.ok(out.slice(1).every((l) => l.tier !== "feature"));
	});

	test("a low-richness event (score < 3) is never a feature", () => {
		const events = [event({ id: "0" })].concat(
			Array.from({ length: 8 }, (_, i) => event({ id: `n${i}`, image_path: "/i.jpg" })), // richness 2
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
		for (let i = 1; i < idx.length; i++) {
			assert.ok(idx[i] - idx[i - 1] >= 3, `features too close: ${idx}`);
		}
	});

	test("layout is deterministic for the same ids", () => {
		const make = () =>
			[event({ id: "0" })].concat(Array.from({ length: 20 }, (_, i) => eligible(`e${i}`)));
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
```

- [ ] **Step 6: Run the tests to verify the new ones fail**

Run: `npx tsx --test web/test/cover-card-layout.test.ts`
Expected: FAIL — `coverCardLayouts is not a function` (not yet exported).

- [ ] **Step 7: Implement `coverCardLayouts`**

Append to `web/src/components/cover-card-layout.ts`:

```ts
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
			sinceFeature = 0;
			return { tier: "hero", showCalendar: true, showLocation: true };
		}
		const eligible = Boolean(e.image_path) && richness(e) >= 3;
		if (eligible && sinceFeature >= MIN_GAP && jitter(e.id) < PROMOTE_THRESHOLD) {
			sinceFeature = 0;
			return { tier: "feature", showCalendar: true, showLocation: true };
		}
		sinceFeature++;
		return { tier: "normal", showCalendar: false, showLocation: false };
	});
}
```

- [ ] **Step 8: Run the tests to verify all pass**

Run: `npx tsx --test web/test/cover-card-layout.test.ts`
Expected: PASS — `tests 7`, `pass 7`, `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/cover-card-layout.ts web/test/cover-card-layout.test.ts
git commit -m "feat(web): cover card layout + importance logic"
```

---

## Task 2: CoverGrid component

**Files:**
- Create: `web/src/components/CoverGrid.vue`

> No unit test — this is presentational. Correctness is verified by the typecheck/build in this task and the visual check in Task 4. The grid span / row-height values below are sensible starting points; fine-tune them in Task 4 with the app running.

- [ ] **Step 1: Create the component**

Create `web/src/components/CoverGrid.vue`:

```vue
<script setup lang="ts">
import { Clock } from "@lucide/vue";
import { computed } from "vue";
import type { Calendar, Event } from "@/api/client";
import { imageSrc } from "@/api/client";
import { type CoverTier, coverCardLayouts } from "@/components/cover-card-layout";

// Cover/gallery face: an editorial landscape mosaic. The soonest event is the
// hero; information-rich events are promoted to larger cards. Each image carries
// a uniform dark mask so the white text stays readable. Events without a cover
// fall back to a gradient from their calendar colour. Today and the future,
// soonest first.
const props = defineProps<{ events: Event[]; calendars: Calendar[] }>();
const emit = defineEmits<{ open: [event: Event] }>();

const pad = (n: number) => String(n).padStart(2, "0");
function dayKey(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const upcoming = computed(() => {
	const now = new Date();
	const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	return [...props.events]
		.sort((a, b) => a.start_at.localeCompare(b.start_at))
		.filter((e) => dayKey(e.start_at) >= todayKey);
});

const coverCards = computed(() => {
	const layouts = coverCardLayouts(upcoming.value);
	return upcoming.value.map((event, i) => ({ event, layout: layouts[i] }));
});

function calColor(id: string): string {
	return props.calendars.find((c) => c.id === id)?.color ?? "#94a3b8";
}

function mediaStyle(e: Event): Record<string, string> {
	if (e.image_path) return { backgroundImage: `url(${imageSrc(e.image_path)})` };
	// color-mix keeps this format-agnostic (no hex-only assumption like `${c}88`).
	const c = calColor(e.calendar_id);
	return {
		background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, var(--color-base-300)))`,
	};
}

function tierClass(tier: CoverTier): string {
	if (tier === "hero") return "col-span-4 row-span-4 xl:col-span-6";
	if (tier === "feature") return "col-span-4 row-span-3 xl:col-span-4";
	return "col-span-2 row-span-2 xl:col-span-2";
}

function titleClass(tier: CoverTier): string {
	if (tier === "hero") return "text-xl sm:text-2xl";
	if (tier === "feature") return "text-lg";
	return "text-sm";
}

function when(e: Event): string {
	const d = new Date(e.start_at);
	const date = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
	if (e.all_day) return `${date} · All day`;
	return `${date} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function calendarName(id: string): string {
	return props.calendars.find((c) => c.id === id)?.name ?? "Calendar";
}
</script>

<template>
	<div
		v-if="upcoming.length"
		class="grid auto-rows-[3rem] grid-flow-row-dense grid-cols-4 gap-3 pb-2 sm:auto-rows-[3.25rem] sm:grid-cols-8 sm:gap-4 xl:grid-cols-12"
	>
		<button
			v-for="{ event: e, layout } in coverCards"
			:key="e.id"
			type="button"
			class="card group relative overflow-hidden rounded-box text-left shadow-md transition-shadow duration-200 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:transition motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99]"
			:class="tierClass(layout.tier)"
			@click="emit('open', e)"
		>
			<!-- Media: cover image, or a gradient from the calendar colour. -->
			<span
				class="absolute inset-0 bg-cover bg-center motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105"
				:style="mediaStyle(e)"
				aria-hidden="true"
			/>
			<!-- The uniform dark mask over the whole image. -->
			<span class="absolute inset-0 bg-black/45" aria-hidden="true" />

			<!-- Content, bottom-left over the mask. -->
			<div class="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 p-3 text-white sm:p-4">
				<div v-if="layout.showCalendar" class="flex items-center gap-1.5">
					<span
						class="badge badge-sm gap-1 border-0 bg-white/15 font-medium text-white backdrop-blur-md"
					>
						<span
							class="size-1.5 rounded-full"
							:style="{ background: calColor(e.calendar_id) }"
							aria-hidden="true"
						/>
						{{ calendarName(e.calendar_id) }}
					</span>
					<span
						v-if="e.tags.length"
						class="badge badge-sm border-0 bg-primary font-semibold text-primary-content"
					>
						{{ e.tags[0] }}
					</span>
				</div>

				<h3 class="font-extrabold drop-shadow-sm" :class="titleClass(layout.tier)" :title="e.title">
					<span class="block" :class="layout.tier === 'hero' ? 'line-clamp-2' : 'truncate'">
						{{ e.title }}
					</span>
				</h3>

				<p class="flex items-center gap-1 text-xs font-medium text-white/85">
					<Clock :size="13" class="shrink-0 opacity-80" aria-hidden="true" />
					<span class="truncate">
						{{ when(e) }}<template v-if="e.location && layout.showLocation"> · {{ e.location }}</template>
					</span>
				</p>
			</div>
		</button>
	</div>
	<div v-else class="py-16 text-center text-sm text-base-content/50">
		No upcoming events.
	</div>
</template>
```

- [ ] **Step 2: Typecheck + build**

Run: `npm --prefix web run build`
Expected: `vue-tsc` passes and `vite build` completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/CoverGrid.vue
git commit -m "feat(web): CoverGrid editorial landscape mosaic"
```

---

## Task 3: Restore route, ListView branch, and nav links

**Files:**
- Modify: `web/src/router.ts`
- Modify: `web/src/views/ListView.vue`
- Modify: `web/src/App.vue`
- Modify: `web/src/components/BottomDock.vue`

- [ ] **Step 1: Add the `/cover` route**

In `web/src/router.ts`, replace:

```ts
		{
			path: "/list",
			name: "list",
			component: () => import("@/views/ListView.vue"),
		},
		{
			path: "/pair",
```

with:

```ts
		{
			path: "/list",
			name: "list",
			component: () => import("@/views/ListView.vue"),
		},
		{
			path: "/cover",
			name: "cover",
			component: () => import("@/views/ListView.vue"),
		},
		{
			path: "/pair",
```

- [ ] **Step 2: Import `useRoute` and `CoverGrid` in ListView**

In `web/src/views/ListView.vue`, replace:

```ts
import { computed, onMounted, ref, watch } from "vue";
import type { Event, Tag } from "@/api/client";
import AgendaList from "@/components/AgendaList.vue";
import EventModal from "@/components/EventModal.vue";
```

with:

```ts
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { Event, Tag } from "@/api/client";
import AgendaList from "@/components/AgendaList.vue";
import CoverGrid from "@/components/CoverGrid.vue";
import EventModal from "@/components/EventModal.vue";
```

- [ ] **Step 3: Add the `coverMode` computed**

In `web/src/views/ListView.vue`, replace:

```ts
const filterSheet = useFilterSheet();

const search = ref("");
```

with:

```ts
const filterSheet = useFilterSheet();

const route = useRoute();
const coverMode = computed(() => route.name === "cover");

const search = ref("");
```

- [ ] **Step 4: Render CoverGrid on the cover route**

In `web/src/views/ListView.vue`, replace:

```html
			<AgendaList
				:events="visibleEvents"
				:calendars="calendars"
				:tags="tags"
				@open="openView"
			/>
```

with:

```html
			<CoverGrid
				v-if="coverMode"
				:events="visibleEvents"
				:calendars="calendars"
				@open="openView"
			/>
			<AgendaList
				v-else
				:events="visibleEvents"
				:calendars="calendars"
				:tags="tags"
				@open="openView"
			/>
```

- [ ] **Step 5: Add the desktop "Cover" nav link**

In `web/src/App.vue`, replace:

```ts
import { CalendarDays, List, LogOut, Menu, Upload } from "@lucide/vue";
```

with:

```ts
import { CalendarDays, Images, List, LogOut, Menu, Upload } from "@lucide/vue";
```

Then replace:

```html
					<RouterLink to="/list" :class="linkBase" :exact-active-class="linkActive">
						<List :size="16" aria-hidden="true" />
						<span>List</span>
					</RouterLink>
				</nav>
```

with:

```html
					<RouterLink to="/list" :class="linkBase" :exact-active-class="linkActive">
						<List :size="16" aria-hidden="true" />
						<span>List</span>
					</RouterLink>
					<RouterLink to="/cover" :class="linkBase" :exact-active-class="linkActive">
						<Images :size="16" aria-hidden="true" />
						<span>Cover</span>
					</RouterLink>
				</nav>
```

- [ ] **Step 6: Add the mobile "Cover" nav link**

In `web/src/components/BottomDock.vue`, replace:

```ts
	CalendarDays,
	List,
```

with:

```ts
	CalendarDays,
	Images,
	List,
```

Then replace:

```html
		<RouterLink to="/list" :class="{ 'dock-active text-primary': isActive('list') }">
			<List :size="20" aria-hidden="true" />
			<span class="dock-label">List</span>
		</RouterLink>

		<div class="dropdown dropdown-top dropdown-end">
```

with:

```html
		<RouterLink to="/list" :class="{ 'dock-active text-primary': isActive('list') }">
			<List :size="20" aria-hidden="true" />
			<span class="dock-label">List</span>
		</RouterLink>

		<RouterLink to="/cover" :class="{ 'dock-active text-primary': isActive('cover') }">
			<Images :size="20" aria-hidden="true" />
			<span class="dock-label">Cover</span>
		</RouterLink>

		<div class="dropdown dropdown-top dropdown-end">
```

- [ ] **Step 7: Typecheck + build**

Run: `npm --prefix web run build`
Expected: `vue-tsc` passes and `vite build` completes with no errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/router.ts web/src/views/ListView.vue web/src/App.vue web/src/components/BottomDock.vue
git commit -m "feat(web): restore cover route + nav links"
```

---

## Task 4: Visual verification & tuning

**Files:** `web/src/components/CoverGrid.vue` (span/row-height tuning only)

- [ ] **Step 1: Start the app**

Run (each in the background): `npm run dev` (backend, port 4010) and `npm run web:dev` (Vite, port 5173). The web proxies `/api` to the backend. Open `http://localhost:5173/cover`. (The API needs a paired browser session; if a pairing screen appears, that is auth, not the cover.)

- [ ] **Step 2: Verify the design against the spec**

Check, on a phone-width and a desktop-width window:
- The soonest event renders as the hero (largest tile).
- Information-rich events occasionally break out to larger `feature` tiles; big tiles are **not** adjacent and do **not** fall on a fixed every-Nth beat.
- Every image carries the uniform dark mask; white title + meta are readable.
- Image-less events show the calendar-colour gradient (still masked, still readable).
- Tiles are landscape; none are thin full-width bands; cards are borderless.
- No grid gaps (dense packing).

- [ ] **Step 3: Tune if needed**

Adjust only the grid values in `CoverGrid.vue` if a tier looks too wide/thin/tall: the container `auto-rows-[...]` / `grid-cols-*` and `tierClass()` spans. Keep big tiles landscape and never full-width thin bands. Re-check in the browser.

- [ ] **Step 4: Final build + commit (only if Step 3 changed anything)**

Run: `npm --prefix web run build`
Expected: passes.

```bash
git add web/src/components/CoverGrid.vue
git commit -m "fmt(web): tune cover grid proportions"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Uniform dark mask over whole image → Task 2 (`bg-black/45` overlay). ✓
- Size tiers hero/feature/normal → Task 1 (logic) + Task 2 (`tierClass`). ✓
- "Important" = image + richness ≥ 3 → Task 1 (`eligible`). ✓
- Non-repeating jitter + min spacing → Task 1 (`jitter`, `MIN_GAP`) + tests. ✓
- Borderless, hover lift, reduced-motion, focus ring → Task 2 (classes). ✓
- daisyui usage (`card`, `badge`, tokens) → Task 2. ✓
- Image-less gradient fallback → Task 2 (`mediaStyle`). ✓
- Restore route + ListView branch + nav → Task 3. ✓
- Testable logic core → Task 1 (`web/test/cover-card-layout.test.ts`). ✓

**Type consistency:** `CoverTier` and `CoverCardLayout` are defined in Task 1 and consumed unchanged in Task 2 (`coverCardLayouts`, `tier`, `showCalendar`, `showLocation`). The test's local `TestEvent` is structurally compatible with the module's internal `CoverEvent`. ✓

**Placeholder scan:** none — all steps contain runnable code/commands. The Task 4 grid values are explicitly flagged as visual-tuning, not placeholders. ✓

**Out of scope (per spec):** image lazy-loading, backend changes, other views.
