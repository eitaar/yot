# yot Web UI Mobile-First Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the yot calendar web app into a borderless "editorial" look, replace the mobile sidebar with a filter bottom sheet, turn the mobile Calendar tab into a real month/week grid, make the List tab a day-grouped agenda, and rebuild the event modal on DaisyUI with inline tag creation.

**Architecture:** All changes are in `web/` (Vue 3 SFCs + Tailwind v4 + DaisyUI v5). Filtering/management UI is extracted into a shared `FiltersPanel` consumed by a desktop `Sidebar` shell and a mobile `FilterSheet` shell. A new `MobileCalendar` component renders the phone grid. Theme tokens live in `style.css`. Module-level singleton composables (`useFilters`, `useSidebar`, new `useFilterSheet`) coordinate shared state.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, Tailwind v4, DaisyUI v5, `@schedule-x/*` (desktop calendar), `@lucide/vue`, Biome (tabs, double quotes).

**Testing note:** This project has **no unit-test runner** for `web/` (only `vue-tsc --noEmit` via build + Biome + manual browser checks). Tasks therefore verify with: `npm --prefix web run build` (type-clean), `npm run format` (Biome clean), and a described manual check in `npm --prefix web run dev` at mobile (≤640px) and desktop (≥1024px) in light **and** dark. Use tabs for indentation in all code below to satisfy Biome.

---

## Task 1: Editorial theme + fonts foundation

**Files:**
- Modify: `web/package.json` (add font deps)
- Modify: `web/src/main.ts` (import fonts)
- Modify: `web/src/style.css:1-81` (font tokens + both theme blocks)
- Modify: `web/vite.config.ts:18-22` (PWA colors)

- [ ] **Step 1: Add the font packages**

Run:
```bash
npm --prefix web install @fontsource/inter @fontsource/instrument-serif
```
Expected: both added to `web/package.json` dependencies, no errors.

- [ ] **Step 2: Import the fonts in `web/src/main.ts`**

Add these imports directly under `import { createApp } from "vue";`:
```ts
import "@fontsource-variable/inter";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
```
If `@fontsource-variable/inter` is not present (older registry), use instead:
```ts
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
```

- [ ] **Step 3: Add font tokens + rewrite both theme blocks in `web/src/style.css`**

Replace lines 1-81 (from `@import "tailwindcss";` through the `@custom-variant dark ...` line) with:
```css
@import "tailwindcss";
@plugin "daisyui";

@theme {
	--font-sans: "Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
	--font-serif: "Instrument Serif", ui-serif, Georgia, "Times New Roman", serif;
}

/* Light theme - warm paper, ink text, deep emerald. Borderless/editorial. */
@plugin "daisyui/theme" {
	name: "light";
	default: true;
	prefersdark: false;
	color-scheme: light;

	--color-base-100: oklch(0.993 0.005 95);
	--color-base-200: oklch(0.972 0.006 95);
	--color-base-300: oklch(0.922 0.008 92);
	--color-base-content: oklch(0.27 0.012 65);
	--color-primary: oklch(0.55 0.115 162);
	--color-primary-content: oklch(0.985 0.012 160);
	--color-secondary: oklch(0.55 0.02 70);
	--color-secondary-content: oklch(0.985 0.005 95);
	--color-accent: oklch(0.62 0.12 55);
	--color-accent-content: oklch(0.99 0.01 80);
	--color-neutral: oklch(0.30 0.012 65);
	--color-neutral-content: oklch(0.97 0.006 95);
	--color-info: oklch(0.7 0.12 233);
	--color-info-content: oklch(1 0 0);
	--color-success: oklch(0.65 0.14 162);
	--color-success-content: oklch(1 0 0);
	--color-warning: oklch(0.78 0.14 75);
	--color-warning-content: oklch(0.26 0.05 75);
	--color-error: oklch(0.62 0.21 25);
	--color-error-content: oklch(1 0 0);

	--radius-selector: 0.5rem;
	--radius-field: 0.5rem;
	--radius-box: 1rem;
	--size-selector: 0.25rem;
	--size-field: 0.25rem;
	--border: 1px;
	--depth: 0;
	--noise: 0;
}

/* Dark theme - warm near-black surfaces, brighter emerald. */
@plugin "daisyui/theme" {
	name: "dark";
	default: false;
	prefersdark: true;
	color-scheme: dark;

	--color-base-100: oklch(0.205 0.008 70);
	--color-base-200: oklch(0.245 0.008 70);
	--color-base-300: oklch(0.31 0.009 70);
	--color-base-content: oklch(0.93 0.006 90);
	--color-primary: oklch(0.72 0.14 162);
	--color-primary-content: oklch(0.22 0.04 165);
	--color-secondary: oklch(0.7 0.02 80);
	--color-secondary-content: oklch(0.205 0.008 70);
	--color-accent: oklch(0.70 0.13 58);
	--color-accent-content: oklch(0.205 0.008 70);
	--color-neutral: oklch(0.245 0.008 70);
	--color-neutral-content: oklch(0.93 0.006 90);
	--color-info: oklch(0.7 0.12 233);
	--color-info-content: oklch(0.205 0.008 70);
	--color-success: oklch(0.72 0.14 162);
	--color-success-content: oklch(0.22 0.04 165);
	--color-warning: oklch(0.78 0.14 75);
	--color-warning-content: oklch(0.26 0.05 75);
	--color-error: oklch(0.62 0.21 25);
	--color-error-content: oklch(1 0 0);

	--radius-selector: 0.5rem;
	--radius-field: 0.5rem;
	--radius-box: 1rem;
	--size-selector: 0.25rem;
	--size-field: 0.25rem;
	--border: 1px;
	--depth: 0;
	--noise: 0;
}

/* Make Tailwind `dark:` utilities track the dark DaisyUI theme. */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```
Leave the rest of `style.css` (the Schedule-X reskin and `.calendar-frame`/`.calendar-scroll` blocks) unchanged.

- [ ] **Step 4: Update PWA colors in `web/vite.config.ts`**

Change `theme_color: "#0d9488"` to `theme_color: "#047857"` and `background_color: "#ffffff"` to `background_color: "#faf9f7"`.

- [ ] **Step 5: Verify build + format**

Run:
```bash
npm --prefix web run build && npm run format
```
Expected: build succeeds (no vue-tsc errors), Biome reports no errors.

- [ ] **Step 6: Manual check**

Run `npm --prefix web run dev`, open the app. Expected: warm off-white background, deep-emerald primary buttons, Inter body text. Toggle dark mode — surfaces are warm near-black, not cool slate. (Layout still has old borders; those go away in later tasks.)

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/src/main.ts web/src/style.css web/vite.config.ts
git commit -m "feat(webui): editorial theme + Inter/Instrument Serif fonts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `useTags.create` returns the created tag

**Files:**
- Modify: `web/src/composables/useTags.ts:11-14`

- [ ] **Step 1: Return the created tag**

Replace the `create` function:
```ts
	async function create(name: string, color?: string) {
		await api.createTag({ name, ...(color ? { color } : {}) });
		await load();
	}
```
with:
```ts
	async function create(name: string, color?: string) {
		const tag = await api.createTag({ name, ...(color ? { color } : {}) });
		await load();
		return tag;
	}
```

- [ ] **Step 2: Verify build**

Run: `npm --prefix web run build`
Expected: success (existing callers ignore the return value; type is now `Promise<Tag>`).

- [ ] **Step 3: Commit**

```bash
git add web/src/composables/useTags.ts
git commit -m "feat(webui): return created tag from useTags.create

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `useFilterSheet` composable

**Files:**
- Create: `web/src/composables/useFilterSheet.ts`

- [ ] **Step 1: Create the composable**

```ts
import { ref } from "vue";

// Open/close state for the mobile filter bottom sheet. Singleton so the
// Filter button in any view drives the same sheet (mirrors useSidebar).
const isOpen = ref(false);

export function useFilterSheet() {
	function open() {
		isOpen.value = true;
	}
	function close() {
		isOpen.value = false;
	}
	function toggle() {
		isOpen.value = !isOpen.value;
	}
	return { isOpen, open, close, toggle };
}
```

- [ ] **Step 2: Verify build**

Run: `npm --prefix web run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add web/src/composables/useFilterSheet.ts
git commit -m "feat(webui): add useFilterSheet composable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Extract `FiltersPanel.vue` from the sidebar

This moves the Calendars + Tags UI (filter toggles, add, rename, recolor, delete) into a presentational component, restyled borderless. It owns no open/close state.

**Files:**
- Create: `web/src/components/FiltersPanel.vue`

- [ ] **Step 1: Create `web/src/components/FiltersPanel.vue`**

```vue
<script setup lang="ts">
import { Check, MoreHorizontal, Plus, Trash2 } from "@lucide/vue";
import { computed, ref } from "vue";
import type { Calendar, Tag } from "@/api/client";
import ColorPicker from "@/components/ColorPicker.vue";

const props = defineProps<{
	calendars: Calendar[];
	tags: Tag[];
	enabledCalendarIds: Set<string>;
	selectedTag: string | null;
}>();
const emit = defineEmits<{
	"toggle-calendar": [id: string];
	"set-all": [enabled: boolean];
	"select-tag": [name: string | null];
	"add-calendar": [name: string];
	"rename-calendar": [id: string, name: string];
	"recolor-calendar": [id: string, color: string];
	"add-tag": [name: string, color: string | null];
	"rename-tag": [id: string, name: string];
	"recolor-tag": [id: string, color: string];
	"delete-tag": [id: string];
}>();

const allEnabled = computed(
	() =>
		props.calendars.length > 0 &&
		props.calendars.every((c) => props.enabledCalendarIds.has(c.id)),
);

const newCalName = ref("");
const newTagName = ref("");
const newTagColor = ref<string | null>("#10b981");

function addCalendar() {
	const name = newCalName.value.trim();
	if (!name) return;
	emit("add-calendar", name);
	newCalName.value = "";
}

function addTag() {
	const name = newTagName.value.trim();
	if (!name) return;
	emit("add-tag", name, newTagColor.value);
	newTagName.value = "";
	newTagColor.value = "#10b981";
}

function clickTag(name: string) {
	emit("select-tag", props.selectedTag === name ? null : name);
}

function renameFromForm(e: globalThis.Event): string {
	const form = e.target as HTMLFormElement;
	const input = form.elements.namedItem("name") as HTMLInputElement;
	return input.value.trim();
}

// DaisyUI dropdowns open on focus; blurring closes them after an action.
function blurActive() {
	(document.activeElement as HTMLElement | null)?.blur();
}

function submitRenameCalendar(id: string, e: globalThis.Event) {
	emit("rename-calendar", id, renameFromForm(e));
	blurActive();
}

function submitRenameTag(id: string, e: globalThis.Event) {
	emit("rename-tag", id, renameFromForm(e));
	blurActive();
}

function confirmDeleteTag(t: Tag) {
	if (window.confirm(`Delete tag "${t.name}"? Events keep their other tags.`)) {
		emit("delete-tag", t.id);
	}
	blurActive();
}

const sectionHeader =
	"font-serif text-base text-base-content/70";
const optionsTrigger =
	"btn btn-ghost btn-xs opacity-100 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100";
const optionsPanel =
	"dropdown-content z-30 mt-1 w-56 rounded-box bg-base-100 p-3 shadow-lg";
</script>

<template>
	<div class="flex flex-col gap-6">
		<!-- Calendars -->
		<section class="space-y-2">
			<div class="flex items-center justify-between">
				<h2 :class="sectionHeader">Calendars</h2>
				<button
					v-if="calendars.length"
					class="btn btn-ghost btn-xs text-primary"
					@click="emit('set-all', !allEnabled)"
				>
					{{ allEnabled ? "None" : "All" }}
				</button>
			</div>
			<ul class="flex flex-col">
				<li v-for="c in calendars" :key="c.id" class="group">
					<div class="flex items-center gap-1 rounded-field hover:bg-base-200">
						<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5">
							<input
								type="checkbox"
								class="checkbox checkbox-primary checkbox-sm shrink-0"
								:checked="enabledCalendarIds.has(c.id)"
								@change="emit('toggle-calendar', c.id)"
							/>
							<span
								class="inline-block h-3 w-3 shrink-0 rounded-full"
								:style="{ background: c.color ?? 'oklch(0.7 0.04 256)' }"
							/>
							<span class="truncate text-sm">{{ c.name }}</span>
						</label>
						<div class="dropdown dropdown-end">
							<div
								tabindex="0"
								role="button"
								:class="optionsTrigger"
								aria-label="Calendar options"
							>
								<MoreHorizontal :size="15" aria-hidden="true" />
							</div>
							<div tabindex="0" :class="optionsPanel">
								<div class="space-y-3">
									<form
										class="space-y-1"
										@submit.prevent="submitRenameCalendar(c.id, $event)"
									>
										<span :class="sectionHeader">Rename</span>
										<div class="join w-full">
											<input
												name="name"
												:value="c.name"
												class="input input-sm join-item w-full"
											/>
											<button
												class="btn btn-primary btn-sm join-item"
												aria-label="Save calendar name"
											>
												<Check :size="15" aria-hidden="true" />
											</button>
										</div>
									</form>
									<div class="space-y-1">
										<span :class="sectionHeader">Color</span>
										<ColorPicker
											:model-value="c.color"
											@update:model-value="(col) => emit('recolor-calendar', c.id, col)"
										/>
									</div>
								</div>
							</div>
						</div>
					</div>
				</li>
			</ul>
			<form class="join w-full pt-1" @submit.prevent="addCalendar">
				<input
					v-model="newCalName"
					placeholder="New calendar"
					class="input input-sm join-item w-full"
				/>
				<button class="btn btn-neutral btn-sm join-item" aria-label="Add calendar">
					<Plus :size="15" aria-hidden="true" />
				</button>
			</form>
		</section>

		<!-- Tags -->
		<section class="space-y-2">
			<h2 :class="sectionHeader">Tags</h2>
			<ul v-if="tags.length" class="flex flex-col gap-1">
				<li v-for="t in tags" :key="t.id" class="group flex items-center gap-1">
					<button
						class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start gap-2 rounded-full px-2.5 font-normal"
						:style="
							selectedTag === t.name
								? {
										background: t.color ?? 'oklch(0.45 0.03 256)',
										color: '#fff',
									}
								: {}
						"
						:class="selectedTag === t.name ? '' : 'text-base-content'"
						@click="clickTag(t.name)"
					>
						<span
							class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
							:style="{ background: t.color ?? 'oklch(0.7 0.04 256)' }"
						/>
						<span class="truncate">{{ t.name }}</span>
					</button>
					<div class="dropdown dropdown-end">
						<div
							tabindex="0"
							role="button"
							:class="optionsTrigger"
							aria-label="Tag options"
						>
							<MoreHorizontal :size="15" aria-hidden="true" />
						</div>
						<div tabindex="0" :class="optionsPanel">
							<div class="space-y-3">
								<form class="space-y-1" @submit.prevent="submitRenameTag(t.id, $event)">
									<span :class="sectionHeader">Rename</span>
									<div class="join w-full">
										<input
											name="name"
											:value="t.name"
											class="input input-sm join-item w-full"
										/>
										<button
											class="btn btn-primary btn-sm join-item"
											aria-label="Save tag name"
										>
											<Check :size="15" aria-hidden="true" />
										</button>
									</div>
								</form>
								<div class="space-y-1">
									<span :class="sectionHeader">Color</span>
									<ColorPicker
										:model-value="t.color"
										@update:model-value="(col) => emit('recolor-tag', t.id, col)"
									/>
								</div>
								<button
									class="btn btn-error btn-outline btn-sm w-full gap-1"
									@click="confirmDeleteTag(t)"
								>
									<Trash2 :size="15" aria-hidden="true" />
									Delete tag
								</button>
							</div>
						</div>
					</div>
				</li>
			</ul>
			<p v-else class="text-xs text-base-content/40">(no tags)</p>

			<form class="space-y-2 pt-1" @submit.prevent="addTag">
				<div class="join w-full">
					<input
						v-model="newTagName"
						placeholder="New tag"
						class="input input-sm join-item w-full"
					/>
					<button class="btn btn-neutral btn-sm join-item" aria-label="Add tag">
						<Plus :size="15" aria-hidden="true" />
					</button>
				</div>
				<ColorPicker v-model="newTagColor" />
			</form>
		</section>
	</div>
</template>
```

- [ ] **Step 2: Verify build + format**

Run: `npm --prefix web run build && npm run format`
Expected: success (component is not yet used; that's fine).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/FiltersPanel.vue
git commit -m "feat(webui): extract borderless FiltersPanel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `Sidebar.vue` becomes a desktop docked shell

**Files:**
- Modify: `web/src/components/Sidebar.vue` (full rewrite)

- [ ] **Step 1: Replace the entire file**

```vue
<script setup lang="ts">
import type { Calendar, Tag } from "@/api/client";
import FiltersPanel from "@/components/FiltersPanel.vue";
import { useSidebar } from "@/composables/useSidebar";

// Desktop-only docked, collapsible filter panel. On mobile the same
// FiltersPanel is shown inside FilterSheet instead. Filter props are passed
// through to FiltersPanel; emit handlers arrive via $attrs and are forwarded.
defineOptions({ inheritAttrs: false });

defineProps<{
	calendars: Calendar[];
	tags: Tag[];
	connected: boolean;
	enabledCalendarIds: Set<string>;
	selectedTag: string | null;
}>();

const { isOpen } = useSidebar();
</script>

<template>
	<aside
		class="hidden shrink-0 flex-col gap-5 overflow-y-auto bg-base-100 transition-[width] lg:flex"
		:class="isOpen ? 'w-64 border-r border-base-200 px-3 py-4' : 'w-0 overflow-hidden'"
	>
		<FiltersPanel
			:calendars="calendars"
			:tags="tags"
			:enabled-calendar-ids="enabledCalendarIds"
			:selected-tag="selectedTag"
			v-bind="$attrs"
		/>
		<div class="mt-auto px-1">
			<span
				class="badge badge-sm gap-1"
				:class="connected ? 'badge-success' : 'badge-error'"
			>
				{{ connected ? "Live" : "Offline" }}
			</span>
		</div>
	</aside>
</template>
```

Note: the desktop sidebar's mobile-overlay behavior is removed (it is now `hidden ... lg:flex`). Views will render `<Sidebar>` only at desktop and `<FilterSheet>` only at mobile (Tasks 9 & 11), so the `hidden lg:flex` is belt-and-suspenders.

- [ ] **Step 2: Verify build + format**

Run: `npm --prefix web run build && npm run format`
Expected: success. (Views still bind the same props/emits; emit handlers now flow through `$attrs` → FiltersPanel.)

- [ ] **Step 3: Manual check (desktop)**

`npm --prefix web run dev`, widen to ≥1024px. Expected: borderless sidebar (single hairline on the right), calendars/tags work as before, collapse via the header hamburger still works.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Sidebar.vue
git commit -m "refactor(webui): Sidebar wraps FiltersPanel, desktop-only

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `FilterSheet.vue` mobile bottom sheet

**Files:**
- Create: `web/src/components/FilterSheet.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
import { X } from "@lucide/vue";
import type { Calendar, Tag } from "@/api/client";
import FiltersPanel from "@/components/FiltersPanel.vue";
import { useFilterSheet } from "@/composables/useFilterSheet";

// Mobile filter/management surface: a bottom sheet wrapping FiltersPanel.
// Emit handlers arrive via $attrs and are forwarded to FiltersPanel.
defineOptions({ inheritAttrs: false });

defineProps<{
	calendars: Calendar[];
	tags: Tag[];
	connected: boolean;
	enabledCalendarIds: Set<string>;
	selectedTag: string | null;
}>();

const { isOpen, close } = useFilterSheet();
</script>

<template>
	<div
		class="modal modal-bottom lg:hidden"
		:class="{ 'modal-open': isOpen }"
		@click.self="close()"
	>
		<div class="modal-box max-h-[85dvh] pb-[calc(1rem+env(safe-area-inset-bottom))]">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="font-serif text-xl">Filters</h2>
				<div class="flex items-center gap-2">
					<span
						class="badge badge-sm gap-1"
						:class="connected ? 'badge-success' : 'badge-error'"
					>
						{{ connected ? "Live" : "Offline" }}
					</span>
					<button type="button" class="btn btn-ghost btn-sm btn-circle" @click="close()">
						<X :size="18" aria-hidden="true" />
						<span class="sr-only">Close</span>
					</button>
				</div>
			</div>
			<FiltersPanel
				:calendars="calendars"
				:tags="tags"
				:enabled-calendar-ids="enabledCalendarIds"
				:selected-tag="selectedTag"
				v-bind="$attrs"
			/>
		</div>
	</div>
</template>
```

- [ ] **Step 2: Verify build + format**

Run: `npm --prefix web run build && npm run format`
Expected: success (not yet mounted; wired in Tasks 9 & 11).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/FilterSheet.vue
git commit -m "feat(webui): add mobile FilterSheet bottom sheet

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: App shell — desktop-only hamburger, borderless header

**Files:**
- Modify: `web/src/App.vue:39-51` (header chrome)

- [ ] **Step 1: Make the hamburger desktop-only and restyle the header**

Replace the header opening + hamburger + wordmark block (lines 39-51):
```vue
			<header class="navbar min-h-0 border-b border-base-300 bg-base-100 px-2 py-1.5">
				<button
					class="btn btn-square btn-ghost btn-sm"
					aria-label="Toggle sidebar"
					:aria-expanded="sidebar.isOpen.value"
					@click="sidebar.toggle()"
				>
					<Menu :size="18" aria-hidden="true" />
				</button>
				<span class="flex items-center gap-2 px-2 font-semibold">
					<span class="inline-block h-4 w-4 rounded bg-primary" />
					yot
				</span>
```
with:
```vue
			<header class="navbar min-h-0 border-b border-base-200 bg-base-100 px-2 py-1.5">
				<button
					class="btn btn-square btn-ghost btn-sm hidden lg:inline-flex"
					aria-label="Toggle sidebar"
					:aria-expanded="sidebar.isOpen.value"
					@click="sidebar.toggle()"
				>
					<Menu :size="18" aria-hidden="true" />
				</button>
				<span class="flex items-center gap-2 px-2 lg:px-2">
					<span class="inline-block h-4 w-4 rounded bg-primary" />
					<span class="font-serif text-xl leading-none">yot</span>
				</span>
```

- [ ] **Step 2: Verify build + format**

Run: `npm --prefix web run build && npm run format`
Expected: success.

- [ ] **Step 3: Manual check**

At ≤640px: no hamburger in the header; `yot` wordmark is serif. At ≥1024px: hamburger present and toggles the sidebar.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.vue
git commit -m "feat(webui): desktop-only sidebar toggle, serif wordmark

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Restyle `AgendaList.vue` borderless

**Files:**
- Modify: `web/src/components/AgendaList.vue:77-131` (template only)

- [ ] **Step 1: Replace the `<template>` block**

Replace the entire `<template>...</template>` (lines 77-131) with:
```vue
<template>
	<div v-if="groups.length" class="flex flex-col gap-3 pb-2">
		<section v-for="g in groups" :key="g.key">
			<h2
				class="sticky top-0 z-10 bg-base-100/95 px-1 py-2 font-serif text-lg text-base-content/80 backdrop-blur"
			>
				{{ g.label }}
			</h2>
			<ul class="flex flex-col divide-y divide-base-200">
				<li v-for="e in g.events" :key="e.id">
					<button
						type="button"
						class="flex w-full items-stretch gap-3 rounded-field px-1 py-2.5 text-left transition-colors hover:bg-base-200 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
						@click="emit('open', e)"
					>
						<span
							class="w-1 shrink-0 rounded-full"
							:style="{ background: calColor(e.calendar_id) }"
							aria-hidden="true"
						/>
						<span class="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
							<span class="flex items-center justify-between gap-2">
								<span class="truncate font-medium">{{ e.title }}</span>
								<span class="shrink-0 text-xs tabular-nums text-base-content/60">
									{{ eventTime(e) }}
								</span>
							</span>
							<span
								v-if="e.location"
								class="flex items-center gap-1 truncate text-xs text-base-content/50"
							>
								<MapPin :size="12" aria-hidden="true" />
								<span class="truncate">{{ e.location }}</span>
							</span>
							<span v-if="e.tags.length" class="flex flex-wrap gap-1 pt-0.5">
								<span
									v-for="t in e.tags"
									:key="t"
									class="h-2 w-2 rounded-full"
									:style="{ background: tagColor(t) }"
									:title="t"
								/>
							</span>
						</span>
					</button>
				</li>
			</ul>
		</section>
	</div>
	<div v-else class="py-16 text-center text-sm text-base-content/50">
		No upcoming events.
	</div>
</template>
```

- [ ] **Step 2: Verify build + format**

Run: `npm --prefix web run build && npm run format`
Expected: success.

- [ ] **Step 3: Manual check**

On the mobile Calendar tab (still shows AgendaList until Task 11): day headers are serif, event rows are separated by hairlines with a color accent stripe, no boxed cards.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AgendaList.vue
git commit -m "style(webui): borderless agenda rows with serif day headers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: List tab = agenda list + filter sheet + inline tag creation wiring

**Files:**
- Modify: `web/src/views/ListView.vue` (full rewrite)

- [ ] **Step 1: Replace the entire file**

```vue
<script setup lang="ts">
import { Plus, Search, SlidersHorizontal } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import type { Event, Tag } from "@/api/client";
import AgendaList from "@/components/AgendaList.vue";
import EventModal from "@/components/EventModal.vue";
import FilterSheet from "@/components/FilterSheet.vue";
import Sidebar from "@/components/Sidebar.vue";
import { useCalendars } from "@/composables/useCalendars";
import { useComposer } from "@/composables/useComposer";
import { useEvents } from "@/composables/useEvents";
import { useFilters } from "@/composables/useFilters";
import { useFilterSheet } from "@/composables/useFilterSheet";
import { useSSE } from "@/composables/useSSE";
import { useTags } from "@/composables/useTags";

const {
	calendars,
	load: loadCals,
	create: addCal,
	update: updateCal,
} = useCalendars();
const {
	events,
	load: loadEvents,
	create: addEvent,
	update: updateEvent,
	addTag: addEventTag,
	removeTag: removeEventTag,
} = useEvents();
const {
	tags,
	load: loadTags,
	create: createTag,
	update: updateTag,
	remove: removeTag,
} = useTags();
const {
	enabledCalendarIds,
	selectedTag,
	syncCalendars,
	toggleCalendar,
	setAllCalendars,
	setTag,
	buildQuery,
	applyCalendarFilter,
} = useFilters();

const filterSheet = useFilterSheet();

const search = ref("");
const modalMode = ref<"create" | "view" | "edit" | null>(null);
const selected = ref<Event | null>(null);
const modalRef = ref<InstanceType<typeof EventModal> | null>(null);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function query(): Record<string, string> {
	const q = buildQuery();
	if (search.value) q.q = search.value;
	return q;
}

async function refresh() {
	await Promise.all([loadCals(), loadTags(), loadEvents(query())]);
	syncCalendars(calendars.value.map((c) => c.id));
}

const visibleEvents = computed(() => applyCalendarFilter(events.value));

watch(selectedTag, refresh);

function closeModal() {
	modalMode.value = null;
	selected.value = null;
}
function openCreate() {
	selected.value = null;
	modalMode.value = "create";
}
function openView(e: Event) {
	selected.value = e;
	modalMode.value = "view";
}

function tagIdsOf(names: string[]): Set<string> {
	return new Set(
		names
			.map((n) => tags.value.find((t) => t.name === n)?.id)
			.filter((id): id is string => !!id),
	);
}

async function onCreateTag(name: string, color?: string): Promise<Tag> {
	return await createTag(name, color);
}

async function onCreate(
	input: Parameters<typeof addEvent>[0],
	tagIds: string[],
) {
	try {
		const created = await addEvent(input);
		for (const tagId of tagIds) await addEventTag(created.id, tagId);
		await refresh();
		closeModal();
	} catch (e) {
		modalRef.value?.setError(msg(e));
	}
}

async function onSave(
	id: string,
	updates: Parameters<typeof updateEvent>[1],
	tagIds: string[],
) {
	try {
		await updateEvent(id, updates);
		const current = tagIdsOf(selected.value?.tags ?? []);
		const desired = new Set(tagIds);
		for (const tagId of desired) {
			if (!current.has(tagId)) await addEventTag(id, tagId);
		}
		for (const tagId of current) {
			if (!desired.has(tagId)) await removeEventTag(id, tagId);
		}
		await refresh();
		closeModal();
	} catch (e) {
		modalRef.value?.setError(msg(e));
	}
}

const composer = useComposer();
watch(
	() => composer.tick.value,
	() => openCreate(),
);

const { connected } = useSSE(refresh);
onMounted(refresh);
</script>

<template>
	<div class="flex w-full">
		<Sidebar
			:calendars="calendars"
			:connected="connected"
			:tags="tags"
			:enabled-calendar-ids="enabledCalendarIds"
			:selected-tag="selectedTag"
			@toggle-calendar="(id) => toggleCalendar(id)"
			@set-all="(enabled) => setAllCalendars(enabled)"
			@select-tag="(name) => setTag(name)"
			@add-calendar="(name) => addCal(name)"
			@rename-calendar="(id, name) => updateCal(id, { name })"
			@recolor-calendar="(id, color) => updateCal(id, { color })"
			@add-tag="(name, color) => createTag(name, color ?? undefined)"
			@rename-tag="(id, name) => updateTag(id, { name })"
			@recolor-tag="(id, color) => updateTag(id, { color })"
			@delete-tag="(id) => removeTag(id)"
		/>
		<div class="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
			<div class="flex items-center gap-2">
				<button
					class="btn btn-ghost btn-sm gap-1 px-2 lg:hidden"
					aria-label="Filters"
					@click="filterSheet.open()"
				>
					<SlidersHorizontal :size="16" aria-hidden="true" />
				</button>
				<div class="join min-w-0 flex-1 sm:flex-none">
					<input
						v-model="search"
						placeholder="Search events"
						class="input input-sm join-item w-full sm:w-72"
						@keyup.enter="refresh"
					/>
					<button class="btn btn-neutral btn-sm join-item gap-1 px-2" @click="refresh">
						<Search :size="15" aria-hidden="true" />
						<span class="hidden sm:inline">Search</span>
					</button>
				</div>
				<button class="btn btn-primary btn-sm gap-1 px-2 sm:ml-auto" @click="openCreate">
					<Plus :size="16" aria-hidden="true" />
					<span class="hidden sm:inline">New event</span>
				</button>
			</div>
			<AgendaList
				:events="visibleEvents"
				:calendars="calendars"
				:tags="tags"
				@open="openView"
			/>
		</div>
	</div>
	<FilterSheet
		:calendars="calendars"
		:connected="connected"
		:tags="tags"
		:enabled-calendar-ids="enabledCalendarIds"
		:selected-tag="selectedTag"
		@toggle-calendar="(id) => toggleCalendar(id)"
		@set-all="(enabled) => setAllCalendars(enabled)"
		@select-tag="(name) => setTag(name)"
		@add-calendar="(name) => addCal(name)"
		@rename-calendar="(id, name) => updateCal(id, { name })"
		@recolor-calendar="(id, color) => updateCal(id, { color })"
		@add-tag="(name, color) => createTag(name, color ?? undefined)"
		@rename-tag="(id, name) => updateTag(id, { name })"
		@recolor-tag="(id, color) => updateTag(id, { color })"
		@delete-tag="(id) => removeTag(id)"
	/>
	<EventModal
		v-if="modalMode"
		ref="modalRef"
		:key="`${modalMode}-${selected?.id ?? 'new'}`"
		:mode="modalMode"
		:event="selected"
		:calendars="calendars"
		:tags="tags"
		:create-tag="onCreateTag"
		@close="closeModal"
		@create="onCreate"
		@save="onSave"
	/>
</template>
```

Note: `Sidebar`/`FilterSheet` visibility is purely CSS-driven (`hidden lg:flex` / `lg:hidden`); both are always mounted but only one shows, so no `isDesktop` ref is needed here. The `:create-tag="onCreateTag"` prop is consumed by the EventModal rebuilt in Task 12.

- [ ] **Step 2: Verify build + format**

Run: `npm --prefix web run build && npm run format`
Expected: success. (`EventModal`'s `createTag` prop is optional — see Task 12 — so passing `:create-tag` builds clean regardless of task order.)

- [ ] **Step 3: Manual check**

At ≤640px: List tab shows the day-grouped agenda; a Filters button (sliders icon) opens the bottom sheet; search works. At ≥1024px: sidebar visible, no Filters button.

- [ ] **Step 4: Commit**

```bash
git add web/src/views/ListView.vue
git commit -m "feat(webui): List tab uses agenda list + filter sheet

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: `MobileCalendar.vue` month/week grid

**Files:**
- Create: `web/src/components/MobileCalendar.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
import { CalendarPlus, ChevronLeft, ChevronRight } from "@lucide/vue";
import { computed, ref } from "vue";
import type { Calendar, Event, Tag } from "@/api/client";

// Mobile calendar face: a month grid (colored dots per day) or a week strip,
// with the selected day's events listed below. Desktop uses Schedule-X.
const props = defineProps<{
	events: Event[];
	calendars: Calendar[];
	tags: Tag[];
}>();
const emit = defineEmits<{
	open: [event: Event];
	create: [prefill: { start: string; end: string; all_day: boolean }];
}>();

const pad = (n: number) => String(n).padStart(2, "0");
function dayKey(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}
function addDays(d: Date, n: number): Date {
	const x = startOfDay(d);
	x.setDate(x.getDate() + n);
	return x;
}
function addMonths(d: Date, n: number): Date {
	const x = startOfDay(d);
	x.setDate(1);
	x.setMonth(x.getMonth() + n);
	return x;
}
function startOfWeek(d: Date): Date {
	const x = startOfDay(d);
	x.setDate(x.getDate() - x.getDay());
	return x;
}

const view = ref<"month" | "week">("month");
const cursor = ref(startOfDay(new Date()));
const selected = ref(startOfDay(new Date()));

const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];

const byDay = computed(() => {
	const m = new Map<string, Event[]>();
	for (const e of props.events) {
		const k = dayKey(new Date(e.start_at));
		const arr = m.get(k);
		if (arr) arr.push(e);
		else m.set(k, [e]);
	}
	for (const arr of m.values()) {
		arr.sort((a, b) => a.start_at.localeCompare(b.start_at));
	}
	return m;
});

const monthDays = computed(() => {
	const first = new Date(cursor.value.getFullYear(), cursor.value.getMonth(), 1);
	const last = new Date(
		cursor.value.getFullYear(),
		cursor.value.getMonth() + 1,
		0,
	);
	const start = startOfWeek(first);
	const end = addDays(startOfWeek(last), 6);
	const days: Date[] = [];
	for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
	return days;
});

const weekDays = computed(() => {
	const start = startOfWeek(cursor.value);
	return Array.from({ length: 7 }, (_, i) => addDays(start, i));
});

const periodLabel = computed(() =>
	cursor.value.toLocaleDateString([], { month: "long", year: "numeric" }),
);

const selectedLabel = computed(() =>
	selected.value.toLocaleDateString([], {
		weekday: "long",
		month: "short",
		day: "numeric",
	}),
);

const selectedEvents = computed(
	() => byDay.value.get(dayKey(selected.value)) ?? [],
);

function calColor(id: string): string {
	return props.calendars.find((c) => c.id === id)?.color ?? "#94a3b8";
}

function dotsFor(d: Date): string[] {
	const evs = byDay.value.get(dayKey(d)) ?? [];
	return evs.slice(0, 3).map((e) => calColor(e.calendar_id));
}

function isToday(d: Date): boolean {
	return dayKey(d) === dayKey(new Date());
}
function isSelected(d: Date): boolean {
	return dayKey(d) === dayKey(selected.value);
}
function inCursorMonth(d: Date): boolean {
	return d.getMonth() === cursor.value.getMonth();
}

function eventTime(e: Event): string {
	if (e.all_day) return "All day";
	return new Date(e.start_at).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function prev() {
	cursor.value =
		view.value === "month"
			? addMonths(cursor.value, -1)
			: addDays(cursor.value, -7);
}
function next() {
	cursor.value =
		view.value === "month"
			? addMonths(cursor.value, 1)
			: addDays(cursor.value, 7);
}
function goToday() {
	const t = startOfDay(new Date());
	cursor.value = t;
	selected.value = t;
}
function selectDay(d: Date) {
	selected.value = startOfDay(d);
}
function setView(v: "month" | "week") {
	view.value = v;
	cursor.value = startOfDay(selected.value);
}
function addOnSelected() {
	const k = dayKey(selected.value);
	emit("create", { start: k, end: k, all_day: true });
}
</script>

<template>
	<div class="flex flex-col gap-3 pb-2">
		<!-- View toggle + nav -->
		<div class="flex items-center justify-between gap-2">
			<div class="join">
				<button
					type="button"
					class="btn btn-xs join-item"
					:class="view === 'month' ? 'btn-primary' : 'btn-ghost'"
					@click="setView('month')"
				>
					Month
				</button>
				<button
					type="button"
					class="btn btn-xs join-item"
					:class="view === 'week' ? 'btn-primary' : 'btn-ghost'"
					@click="setView('week')"
				>
					Week
				</button>
			</div>
			<button type="button" class="btn btn-ghost btn-xs text-primary" @click="goToday">
				Today
			</button>
		</div>

		<div class="flex items-center justify-between">
			<button type="button" class="btn btn-ghost btn-sm btn-circle" aria-label="Previous" @click="prev">
				<ChevronLeft :size="18" aria-hidden="true" />
			</button>
			<h2 class="font-serif text-2xl">{{ periodLabel }}</h2>
			<button type="button" class="btn btn-ghost btn-sm btn-circle" aria-label="Next" @click="next">
				<ChevronRight :size="18" aria-hidden="true" />
			</button>
		</div>

		<!-- Weekday header -->
		<div class="grid grid-cols-7 text-center text-xs text-base-content/40">
			<span v-for="(w, i) in weekdayLabels" :key="i" class="py-1">{{ w }}</span>
		</div>

		<!-- Month grid -->
		<div v-if="view === 'month'" class="grid grid-cols-7 gap-1">
			<button
				v-for="d in monthDays"
				:key="dayKey(d)"
				type="button"
				class="flex aspect-square flex-col items-center gap-1 rounded-field pt-1.5 text-sm transition-colors"
				:class="[
					isSelected(d)
						? 'bg-primary text-primary-content'
						: 'hover:bg-base-200',
					!inCursorMonth(d) && !isSelected(d) ? 'text-base-content/30' : '',
					isToday(d) && !isSelected(d) ? 'font-bold text-primary' : '',
				]"
				@click="selectDay(d)"
			>
				<span>{{ d.getDate() }}</span>
				<span class="flex h-1.5 gap-0.5">
					<span
						v-for="(c, i) in dotsFor(d)"
						:key="i"
						class="h-1 w-1 rounded-full"
						:style="{ background: isSelected(d) ? 'currentColor' : c }"
					/>
				</span>
			</button>
		</div>

		<!-- Week strip -->
		<div v-else class="grid grid-cols-7 gap-1">
			<button
				v-for="d in weekDays"
				:key="dayKey(d)"
				type="button"
				class="flex flex-col items-center gap-1 rounded-field py-2 text-sm transition-colors"
				:class="[
					isSelected(d) ? 'bg-primary text-primary-content' : 'hover:bg-base-200',
					isToday(d) && !isSelected(d) ? 'font-bold text-primary' : '',
				]"
				@click="selectDay(d)"
			>
				<span>{{ d.getDate() }}</span>
				<span class="flex h-1.5 gap-0.5">
					<span
						v-for="(c, i) in dotsFor(d)"
						:key="i"
						class="h-1 w-1 rounded-full"
						:style="{ background: isSelected(d) ? 'currentColor' : c }"
					/>
				</span>
			</button>
		</div>

		<!-- Selected day's events -->
		<section class="mt-1">
			<h3 class="px-1 pb-1 font-serif text-lg text-base-content/80">
				{{ selectedLabel }}
			</h3>
			<ul v-if="selectedEvents.length" class="flex flex-col divide-y divide-base-200">
				<li v-for="e in selectedEvents" :key="e.id">
					<button
						type="button"
						class="flex w-full items-stretch gap-3 rounded-field px-1 py-2.5 text-left transition-colors hover:bg-base-200 active:scale-[0.99]"
						@click="emit('open', e)"
					>
						<span
							class="w-1 shrink-0 rounded-full"
							:style="{ background: calColor(e.calendar_id) }"
							aria-hidden="true"
						/>
						<span class="flex min-w-0 flex-1 items-center justify-between gap-2 py-0.5">
							<span class="truncate font-medium">{{ e.title }}</span>
							<span class="shrink-0 text-xs tabular-nums text-base-content/60">
								{{ eventTime(e) }}
							</span>
						</span>
					</button>
				</li>
			</ul>
			<button
				v-else
				type="button"
				class="flex w-full items-center justify-center gap-2 rounded-field py-6 text-sm text-base-content/50 transition-colors hover:bg-base-200"
				@click="addOnSelected"
			>
				<CalendarPlus :size="16" aria-hidden="true" />
				No events — add one
			</button>
		</section>
	</div>
</template>
```

- [ ] **Step 2: Verify build + format**

Run: `npm --prefix web run build && npm run format`
Expected: success (not yet mounted; wired in Task 11).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/MobileCalendar.vue
git commit -m "feat(webui): add mobile month/week calendar grid

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Wire `CalendarView.vue` — mobile grid, filter sheet, desktop toolbar, tag creation

**Files:**
- Modify: `web/src/views/CalendarView.vue` (imports, handler, template)

- [ ] **Step 1: Update imports**

In the `<script setup>` import list, replace:
```ts
import AgendaList from "@/components/AgendaList.vue";
```
with:
```ts
import FilterSheet from "@/components/FilterSheet.vue";
import MobileCalendar from "@/components/MobileCalendar.vue";
```
And add (next to the other composable imports):
```ts
import { useFilterSheet } from "@/composables/useFilterSheet";
```
And add a `Tag` type import to the existing `import type { Event } from "@/api/client";` line, making it:
```ts
import type { Event, Tag } from "@/api/client";
```

- [ ] **Step 2: Add the filter-sheet handle and tag-create handler**

After the line `const composer = useComposer();` add:
```ts
const filterSheet = useFilterSheet();

async function onCreateTag(name: string, color?: string): Promise<Tag> {
	return await createTag(name, color);
}
```

- [ ] **Step 3: Replace the desktop controls card with a borderless toolbar**

Replace the desktop controls block (the `<div class="card border border-base-300 bg-base-100">` … through its closing `</div>` that wraps the view buttons + badges + New event button) with:
```vue
				<!-- Desktop: full Schedule-X grid + controls -->
				<template v-if="isDesktop">
					<div class="flex flex-wrap items-center gap-2 px-1">
						<div class="join">
							<button
								v-for="vw in viewOptions"
								:key="vw.name"
								type="button"
								class="btn btn-sm join-item gap-1 px-2"
								:class="currentView === vw.name ? 'btn-primary' : 'btn-ghost'"
								@click="setCalendarView(vw.name)"
							>
								<component :is="vw.icon" :size="15" aria-hidden="true" />
								<span>{{ vw.label }}</span>
							</button>
						</div>
						<div class="ml-auto flex items-center gap-2 text-xs text-base-content/60">
							<span class="badge badge-ghost">{{ activeCalendarCount }} calendars</span>
							<span class="badge badge-ghost">{{ visibleEventsCount }} events</span>
							<span class="badge" :class="connected ? 'badge-success' : 'badge-error'">
								{{ connected ? "Live" : "Offline" }}
							</span>
						</div>
						<button class="btn btn-primary btn-sm gap-1 px-2" @click="openCreate()">
							<Plus :size="16" aria-hidden="true" />
							<span>New event</span>
						</button>
					</div>
					<div class="calendar-frame">
						<div class="calendar-scroll">
							<ScheduleXCalendar
								:calendar-app="calendarApp"
								:custom-components="customComponents"
							/>
						</div>
					</div>
				</template>
```
Note: the `v-for` loop variable is renamed from `view` to `vw` to avoid shadowing the (unrelated) name; keep `viewOptions`, `currentView`, `setCalendarView`, `activeCalendarCount`, `visibleEventsCount` exactly as defined in the existing script.

- [ ] **Step 4: Replace the mobile branch**

Replace:
```vue
				<!-- Mobile: dedicated agenda day-list -->
				<AgendaList
					v-else
					:events="visibleEvents"
					:calendars="calendars"
					:tags="tags"
					@open="openView"
				/>
```
with:
```vue
				<!-- Mobile: month/week grid -->
				<template v-else>
					<div class="flex items-center px-1">
						<button
							class="btn btn-ghost btn-sm gap-1 px-2"
							aria-label="Filters"
							@click="filterSheet.open()"
						>
							<SlidersHorizontal :size="16" aria-hidden="true" />
							<span>Filters</span>
						</button>
					</div>
					<MobileCalendar
						:events="visibleEvents"
						:calendars="calendars"
						:tags="tags"
						@open="openView"
						@create="(p) => openCreate(p)"
					/>
				</template>
```
Add `SlidersHorizontal` to the `@lucide/vue` import at the top (the line currently importing `CalendarDays, Grid3X3, List, Plus`):
```ts
import { CalendarDays, Grid3X3, List, Plus, SlidersHorizontal } from "@lucide/vue";
```

- [ ] **Step 5: Render `FilterSheet` and add the `create-tag` prop to the modal**

Immediately before the existing `<EventModal …>` element, add:
```vue
		<FilterSheet
			:calendars="calendars"
			:connected="connected"
			:tags="tags"
			:enabled-calendar-ids="enabledCalendarIds"
			:selected-tag="selectedTag"
			@toggle-calendar="(id) => toggleCalendar(id)"
			@set-all="(enabled) => setAllCalendars(enabled)"
			@select-tag="(name) => setTag(name)"
			@add-calendar="(name) => addCal(name)"
			@rename-calendar="(id, name) => updateCal(id, { name })"
			@recolor-calendar="(id, color) => updateCal(id, { color })"
			@add-tag="(name, color) => createTag(name, color ?? undefined)"
			@rename-tag="(id, name) => updateTag(id, { name })"
			@recolor-tag="(id, color) => updateTag(id, { color })"
			@delete-tag="(id) => removeTag(id)"
		/>
```
Then add `:create-tag="onCreateTag"` to the `<EventModal>` prop list (alongside `:tags="tags"`).

- [ ] **Step 6: Verify build + format**

Run: `npm --prefix web run build && npm run format`
Expected: success. (`EventModal`'s `createTag` prop is optional, so the build is clean even before Task 12.)

- [ ] **Step 7: Manual check**

At ≤640px Calendar tab: month grid with colored dots; tap a day → its events list below; empty day shows "No events — add one" which opens the create modal prefilled; Month/Week toggle works; Today resets; Filters button opens the sheet. At ≥1024px: Schedule-X grid with a borderless toolbar (no wrapping card).

- [ ] **Step 8: Commit**

```bash
git add web/src/views/CalendarView.vue
git commit -m "feat(webui): mobile month/week calendar + filter sheet + tag create

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Rebuild `EventModal.vue` on DaisyUI with inline tag creation

**Files:**
- Modify: `web/src/components/EventModal.vue` (full rewrite)

- [ ] **Step 1: Replace the entire file**

```vue
<script setup lang="ts">
import { Check, MapPin, Pencil, Plus, X } from "@lucide/vue";
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import type { Calendar, Event, EventUpdate, Tag } from "@/api/client";
import ColorPicker from "@/components/ColorPicker.vue";

type CreateInput = {
	calendar_id: string;
	title: string;
	start_at: string;
	end_at: string;
	all_day: boolean;
	location?: string;
	description?: string;
};

const props = defineProps<{
	mode: "create" | "view" | "edit";
	event: Event | null;
	calendars: Calendar[];
	tags: Tag[];
	/** Creates a tag and resolves to it, so it can be auto-selected. Optional
	 * so the modal builds even if a caller doesn't wire it. */
	createTag?: (name: string, color?: string) => Promise<Tag>;
	/** Optional create-mode seed (e.g. from clicking an empty calendar slot). */
	prefill?: { start?: string; end?: string; all_day?: boolean } | null;
}>();
const emit = defineEmits<{
	close: [];
	create: [input: CreateInput, tagIds: string[]];
	save: [id: string, updates: EventUpdate, tagIds: string[]];
}>();

const localMode = ref(props.mode);
const error = ref("");
const busy = ref(false);

const form = reactive({
	calendar_id: "",
	title: "",
	description: "",
	location: "",
	all_day: false,
	start: "",
	end: "",
});
const selectedTagIds = ref(new Set<string>());

const showNewTag = ref(false);
const newTagName = ref("");
const newTagColor = ref<string | null>("#10b981");
const creatingTag = ref(false);

const calendar = computed(() =>
	props.calendars.find((c) => c.id === props.event?.calendar_id),
);

function tagColor(name: string): string {
	return props.tags.find((t) => t.name === name)?.color ?? "#64748b";
}

const dateRange = computed(() => {
	const e = props.event;
	if (!e) return "";
	if (e.all_day) {
		const sd = e.start_at.slice(0, 10);
		const ed = e.end_at.slice(0, 10);
		return sd === ed ? sd : `${sd} – ${ed}`;
	}
	const s = new Date(e.start_at);
	const en = new Date(e.end_at);
	const time = (d: Date) =>
		d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return `${s.toLocaleDateString()} ${time(s)} – ${time(en)}`;
});

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (iso: string) => iso.slice(0, 10);
function toDateTimeInput(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fillFromEvent(e: Event) {
	form.calendar_id = e.calendar_id;
	form.title = e.title;
	form.description = e.description ?? "";
	form.location = e.location ?? "";
	form.all_day = e.all_day;
	form.start = e.all_day ? toDateInput(e.start_at) : toDateTimeInput(e.start_at);
	form.end = e.all_day ? toDateInput(e.end_at) : toDateTimeInput(e.end_at);
	selectedTagIds.value = new Set(
		e.tags
			.map((name) => props.tags.find((t) => t.name === name)?.id)
			.filter((id): id is string => !!id),
	);
}

function fillEmpty() {
	form.calendar_id = props.calendars[0]?.id ?? "";
	form.title = "";
	form.description = "";
	form.location = "";
	form.all_day = props.prefill?.all_day ?? false;
	form.start = props.prefill?.start ?? "";
	form.end = props.prefill?.end ?? "";
	selectedTagIds.value = new Set();
}

function startEdit() {
	if (props.event) fillFromEvent(props.event);
	error.value = "";
	localMode.value = "edit";
}

function onAllDayToggle() {
	if (form.all_day) {
		form.start = form.start.slice(0, 10);
		form.end = form.end.slice(0, 10);
	} else {
		if (form.start.length === 10) form.start += "T00:00";
		if (form.end.length === 10) form.end += "T00:00";
	}
}

function toggleTag(id: string) {
	if (selectedTagIds.value.has(id)) selectedTagIds.value.delete(id);
	else selectedTagIds.value.add(id);
}

async function submitNewTag() {
	const create = props.createTag;
	if (!create) return;
	const name = newTagName.value.trim();
	if (!name) return;
	creatingTag.value = true;
	error.value = "";
	try {
		const t = await create(name, newTagColor.value ?? undefined);
		selectedTagIds.value.add(t.id);
		newTagName.value = "";
		newTagColor.value = "#10b981";
		showNewTag.value = false;
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		creatingTag.value = false;
	}
}

function submit() {
	error.value = "";
	if (!form.calendar_id || !form.title || !form.start || !form.end) {
		error.value = "Please fill in the title, calendar, and dates.";
		return;
	}
	const start_at = new Date(form.start).toISOString();
	const end_at = new Date(form.end).toISOString();
	const desc = form.description.trim();
	const loc = form.location.trim();
	const tagIds = [...selectedTagIds.value];
	busy.value = true;
	if (localMode.value === "create") {
		emit(
			"create",
			{
				calendar_id: form.calendar_id,
				title: form.title,
				start_at,
				end_at,
				all_day: form.all_day,
				...(desc ? { description: desc } : {}),
				...(loc ? { location: loc } : {}),
			},
			tagIds,
		);
	} else if (props.event) {
		emit(
			"save",
			props.event.id,
			{
				calendar_id: form.calendar_id,
				title: form.title,
				description: desc || null,
				location: loc || null,
				all_day: form.all_day,
				start_at,
				end_at,
			},
			tagIds,
		);
	}
}

// Parent owns persistence (emits are fire-and-forget). On failure it calls this
// so the modal shows the message and stays open for a retry.
function setError(message: string) {
	error.value = message;
	busy.value = false;
}
defineExpose({ setError });

const title = computed(() =>
	localMode.value === "create"
		? "New event"
		: localMode.value === "edit"
			? "Edit event"
			: (props.event?.title ?? ""),
);

function onKey(e: KeyboardEvent) {
	if (e.key === "Escape") emit("close");
}
onMounted(() => {
	window.addEventListener("keydown", onKey);
	if (props.mode === "create") fillEmpty();
	else if (props.mode === "edit" && props.event) fillFromEvent(props.event);
});
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
	<div class="modal modal-open modal-bottom sm:modal-middle" @click.self="emit('close')">
		<div class="modal-box max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto">
			<div class="mb-4 flex items-start justify-between gap-2">
				<h2 class="font-serif text-2xl leading-tight">{{ title }}</h2>
				<button type="button" class="btn btn-ghost btn-sm btn-circle" @click="emit('close')">
					<X :size="18" aria-hidden="true" />
					<span class="sr-only">Close</span>
				</button>
			</div>

			<!-- View mode -->
			<div v-if="localMode === 'view' && event" class="space-y-3">
				<div class="flex items-center gap-2 text-sm text-base-content/70">
					<span
						class="inline-block h-3 w-3 rounded-full"
						:style="{ background: calendar?.color ?? 'oklch(0.7 0.04 256)' }"
					/>
					<span>{{ calendar?.name ?? "Unknown calendar" }}</span>
				</div>
				<p class="text-sm">
					{{ dateRange }}
					<span v-if="event.all_day" class="ml-1 text-xs text-base-content/50">(all day)</span>
				</p>
				<p v-if="event.location" class="flex items-center gap-1 text-sm">
					<MapPin :size="14" aria-hidden="true" />
					{{ event.location }}
				</p>
				<p v-if="event.description" class="whitespace-pre-wrap text-sm">
					{{ event.description }}
				</p>
				<div v-if="event.tags.length" class="flex flex-wrap gap-1">
					<span
						v-for="t in event.tags"
						:key="t"
						class="badge badge-sm border-0 text-white"
						:style="{ background: tagColor(t) }"
					>
						{{ t }}
					</span>
				</div>
				<div class="modal-action">
					<button class="btn btn-ghost btn-sm" @click="emit('close')">Close</button>
					<button class="btn btn-primary btn-sm gap-1" @click="startEdit">
						<Pencil :size="15" aria-hidden="true" />
						Edit
					</button>
				</div>
			</div>

			<!-- Create / edit form -->
			<form v-else class="flex flex-col gap-2" @submit.prevent="submit">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Title</legend>
					<input v-model="form.title" required class="input w-full" />
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Calendar</legend>
					<select v-model="form.calendar_id" required class="select w-full">
						<option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.name }}</option>
					</select>
				</fieldset>
				<label class="label cursor-pointer justify-start gap-2">
					<input
						v-model="form.all_day"
						type="checkbox"
						class="checkbox checkbox-primary checkbox-sm"
						@change="onAllDayToggle"
					/>
					<span class="label-text">All day</span>
				</label>
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					<fieldset class="fieldset">
						<legend class="fieldset-legend">Start</legend>
						<input
							v-model="form.start"
							:type="form.all_day ? 'date' : 'datetime-local'"
							required
							class="input w-full"
						/>
					</fieldset>
					<fieldset class="fieldset">
						<legend class="fieldset-legend">End</legend>
						<input
							v-model="form.end"
							:type="form.all_day ? 'date' : 'datetime-local'"
							required
							class="input w-full"
						/>
					</fieldset>
				</div>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Location</legend>
					<input v-model="form.location" class="input w-full" />
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Description</legend>
					<textarea v-model="form.description" rows="3" class="textarea w-full" />
				</fieldset>

				<fieldset class="fieldset">
					<legend class="fieldset-legend">Tags</legend>
					<div class="flex flex-wrap gap-1.5">
						<button
							v-for="t in tags"
							:key="t.id"
							type="button"
							class="btn btn-xs gap-1 rounded-full"
							:class="selectedTagIds.has(t.id) ? '' : 'btn-ghost'"
							:style="
								selectedTagIds.has(t.id)
									? { background: t.color ?? 'oklch(0.45 0.03 256)', color: '#fff' }
									: {}
							"
							@click="toggleTag(t.id)"
						>
							<span
								class="inline-block h-2 w-2 rounded-full"
								:style="{ background: t.color ?? 'oklch(0.7 0.04 256)' }"
							/>
							{{ t.name }}
						</button>
						<button
							v-if="createTag"
							type="button"
							class="btn btn-xs btn-ghost gap-1 rounded-full border border-dashed border-base-300"
							@click="showNewTag = !showNewTag"
						>
							<Plus :size="13" aria-hidden="true" />
							New tag
						</button>
					</div>
					<div v-if="showNewTag" class="mt-2 space-y-2 rounded-box bg-base-200 p-3">
						<div class="join w-full">
							<input
								v-model="newTagName"
								placeholder="Tag name"
								class="input input-sm join-item w-full"
								@keyup.enter.prevent="submitNewTag"
							/>
							<button
								type="button"
								class="btn btn-primary btn-sm join-item"
								:disabled="creatingTag"
								aria-label="Create tag"
								@click="submitNewTag"
							>
								<Check :size="15" aria-hidden="true" />
							</button>
						</div>
						<ColorPicker v-model="newTagColor" />
					</div>
				</fieldset>

				<p v-if="error" class="text-sm text-error">{{ error }}</p>

				<div class="modal-action">
					<button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">
						Cancel
					</button>
					<button :disabled="busy" class="btn btn-primary btn-sm gap-1">
						<Check v-if="localMode !== 'create'" :size="15" aria-hidden="true" />
						{{ localMode === "create" ? "Create" : "Save" }}
					</button>
				</div>
			</form>
		</div>
	</div>
</template>
```

- [ ] **Step 2: Verify build + format**

Run: `npm --prefix web run build && npm run format`
Expected: success. Both views already pass `:create-tag="onCreateTag"` (Tasks 9 & 11).

- [ ] **Step 3: Manual check**

Open the create modal (mobile bottom-sheet style, desktop centered). All fields use DaisyUI `fieldset`/`input`/`select`/`textarea`/`checkbox`. Click "New tag" → inline name + color picker; create → the chip appears selected and the new tag persists in the sidebar/sheet. Create/edit/view all work; errors show inline.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/EventModal.vue
git commit -m "feat(webui): DaisyUI event modal with inline tag creation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Build + format clean**

Run:
```bash
npm --prefix web run build && npm run format
```
Expected: type-clean build, Biome no errors.

- [ ] **Full manual sweep** (`npm --prefix web run dev`), at ≤640px and ≥1024px, light **and** dark:
  - Mobile Calendar tab: month grid + dots, day select, Month/Week toggle, Today, empty-day create, Filters sheet (toggle calendars, filter by tag, add/rename/recolor/delete).
  - Mobile List tab: day-grouped agenda, search, Filters sheet.
  - No hamburger/sidebar on mobile; sidebar present + collapsible on desktop.
  - Event modal create/edit/view + inline tag creation auto-selects and persists.
  - Desktop Schedule-X grid renders with the borderless toolbar.
  - No leftover boxed `card border` look anywhere touched.

---

## Spec coverage map

| Spec requirement | Task(s) |
|---|---|
| Editorial borderless theme + fonts | 1 |
| `useTags.create` returns Tag | 2 |
| `useFilterSheet` | 3 |
| Shared `FiltersPanel` | 4 |
| Desktop `Sidebar` shell | 5 |
| Mobile `FilterSheet` (no mobile sidebar) | 6, 9, 11 |
| Desktop-only hamburger, serif header | 7 |
| Borderless agenda list | 8 |
| List tab = agenda list | 9 |
| Mobile month/week calendar | 10, 11 |
| Desktop toolbar restyle | 11 |
| DaisyUI event modal + inline tag creation | 9, 11, 12 |
| Verification | each task + final |
