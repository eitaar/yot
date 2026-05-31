# Frontend Polish (DaisyUI + Theme Toggle + Responsive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four post-redesign UI complaints — no light mode, not responsive, ugly calendar, black text in dark mode — by adopting DaisyUI, adding a light/dark/system theme toggle, making the layout phone-friendly, and reskinning Schedule-X to track the theme.

**Architecture:** DaisyUI v5 is added as a Tailwind v4 CSS plugin with two custom themes (light + dark, emerald primary). A `useTheme` singleton sets `data-theme` on `<html>` from a persisted light/dark/system mode. Components are restyled with DaisyUI semantic classes (so colors invert per theme, fixing contrast). The sidebar becomes a slide-in drawer on mobile via a `useSidebar` state singleton + Tailwind responsive classes (kept per-view to avoid an SSE/state refactor). Schedule-X CSS variables are mapped to DaisyUI tokens so the calendar follows the active theme.

**Tech Stack:** Vue 3 `<script setup>`, Tailwind CSS v4, DaisyUI v5, Schedule-X v2, Vite, vue-router, Biome.

Source of truth: `docs/superpowers/specs/2026-05-31-frontend-daisyui-polish-design.md`.

## Conventions

- TypeScript strict; no `any`. Tabs for indentation; double quotes (Biome).
- Frontend has no test harness: verify each task with `npm --prefix web run build`
  (runs `vue-tsc --noEmit && vite build`) and, at the end, `npx biome check`.
- Backend is untouched; `npm test` must stay green (sanity check at the end only).
- DaisyUI semantic classes replace ad-hoc colors:
  - Surfaces: `bg-base-100` (cards/modals/main), `bg-base-200` (subtle/hover),
    borders `border-base-300`, dividers `divide-base-300`.
  - Text: `text-base-content`; muted: `text-base-content/60`.
  - Accent: `btn btn-primary`, `bg-primary text-primary-content`,
    `text-primary`, `checkbox-primary`.
  - Controls: `input w-full`, `select w-full`, `textarea w-full`,
    `checkbox checkbox-sm`, `badge`.
  - Layout: `navbar`, `card`/`card-body`, `join` (button groups).
- Frequent commits: one per task.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `web/package.json` | modify | add `daisyui` devDependency |
| `web/src/style.css` | rewrite | DaisyUI plugin + light/dark themes + dark variant + base + Schedule-X token mapping |
| `web/src/composables/useTheme.ts` | rewrite | light/dark/system mode, persisted, sets `data-theme` |
| `web/src/composables/useSidebar.ts` | create | shared mobile drawer open/close state |
| `web/src/components/ThemeToggle.vue` | create | light/dark/system segmented control |
| `web/src/App.vue` | rewrite | DaisyUI navbar, hamburger, theme toggle, route-close drawer |
| `web/src/components/Sidebar.vue` | rewrite | responsive drawer + DaisyUI restyle |
| `web/src/components/EventModal.vue` | rewrite | DaisyUI modal/form/badges restyle |
| `web/src/components/ColorPicker.vue` | rewrite | DaisyUI token restyle |
| `web/src/components/Popover.vue` | rewrite | DaisyUI token restyle |
| `web/src/views/ListView.vue` | rewrite | DaisyUI restyle + responsive toolbar |
| `web/src/views/CalendarView.vue` | modify | responsive toolbar + DaisyUI button |
| `web/src/views/PairView.vue` | rewrite | DaisyUI card/input/btn restyle |
| `biome.json` | maybe modify | exclude `style.css` from CSS parsing if `@plugin` errors |

---

## Task 1: Install DaisyUI and rewrite style.css (themes + base + Schedule-X mapping)

**Files:**
- Modify: `web/package.json`
- Rewrite: `web/src/style.css`

- [ ] **Step 1: Install DaisyUI v5**

Run (from repo root):

```bash
npm --prefix web install -D daisyui@5
```

Expected: `daisyui` added under `devDependencies` in `web/package.json`; no errors.

- [ ] **Step 2: Rewrite `web/src/style.css`**

Replace the entire file with:

```css
@import "tailwindcss";
@plugin "daisyui";

/* Light theme (default) — emerald primary, slate-tinted neutrals. */
@plugin "daisyui/theme" {
	name: "light";
	default: true;
	prefersdark: false;
	color-scheme: light;

	--color-base-100: oklch(1 0 0);
	--color-base-200: oklch(0.984 0.003 247.858);
	--color-base-300: oklch(0.929 0.013 255.508);
	--color-base-content: oklch(0.208 0.042 265.755);
	--color-primary: oklch(0.596 0.145 163.225);
	--color-primary-content: oklch(1 0 0);
	--color-secondary: oklch(0.554 0.046 257.417);
	--color-secondary-content: oklch(1 0 0);
	--color-accent: oklch(0.696 0.17 162.48);
	--color-accent-content: oklch(1 0 0);
	--color-neutral: oklch(0.372 0.044 257.287);
	--color-neutral-content: oklch(0.984 0.003 247.858);
	--color-info: oklch(0.7 0.15 233);
	--color-info-content: oklch(1 0 0);
	--color-success: oklch(0.696 0.17 162.48);
	--color-success-content: oklch(1 0 0);
	--color-warning: oklch(0.8 0.16 86);
	--color-warning-content: oklch(0.2 0.05 86);
	--color-error: oklch(0.637 0.237 25.331);
	--color-error-content: oklch(1 0 0);

	--radius-selector: 0.5rem;
	--radius-field: 0.5rem;
	--radius-box: 0.75rem;
	--size-selector: 0.25rem;
	--size-field: 0.25rem;
	--border: 1px;
	--depth: 1;
	--noise: 0;
}

/* Dark theme — slate surfaces, brighter emerald primary. */
@plugin "daisyui/theme" {
	name: "dark";
	default: false;
	prefersdark: true;
	color-scheme: dark;

	--color-base-100: oklch(0.208 0.042 265.755);
	--color-base-200: oklch(0.279 0.041 260.031);
	--color-base-300: oklch(0.372 0.044 257.287);
	--color-base-content: oklch(0.968 0.007 247.896);
	--color-primary: oklch(0.765 0.177 163.223);
	--color-primary-content: oklch(0.262 0.051 172.552);
	--color-secondary: oklch(0.704 0.04 256.788);
	--color-secondary-content: oklch(0.208 0.042 265.755);
	--color-accent: oklch(0.765 0.177 163.223);
	--color-accent-content: oklch(0.262 0.051 172.552);
	--color-neutral: oklch(0.279 0.041 260.031);
	--color-neutral-content: oklch(0.968 0.007 247.896);
	--color-info: oklch(0.7 0.15 233);
	--color-info-content: oklch(0.208 0.042 265.755);
	--color-success: oklch(0.765 0.177 163.223);
	--color-success-content: oklch(0.262 0.051 172.552);
	--color-warning: oklch(0.8 0.16 86);
	--color-warning-content: oklch(0.2 0.05 86);
	--color-error: oklch(0.637 0.237 25.331);
	--color-error-content: oklch(1 0 0);

	--radius-selector: 0.5rem;
	--radius-field: 0.5rem;
	--radius-box: 0.75rem;
	--size-selector: 0.25rem;
	--size-field: 0.25rem;
	--border: 1px;
	--depth: 1;
	--noise: 0;
}

/* Make Tailwind `dark:` utilities track the dark DaisyUI theme. */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* ---- Schedule-X reskin -------------------------------------------------------
   Map Schedule-X variables to DaisyUI tokens. These are live var() references,
   so the calendar tracks the active theme automatically (no separate dark
   block) and its text uses base-content. */
.sx-vue-calendar-wrapper {
	--sx-color-primary: var(--color-primary);
	--sx-color-on-primary: var(--color-primary-content);
	--sx-color-primary-container: color-mix(
		in oklch,
		var(--color-primary) 18%,
		var(--color-base-100)
	);
	--sx-color-on-primary-container: var(--color-base-content);

	--sx-color-background: var(--color-base-100);
	--sx-color-surface: var(--color-base-100);
	--sx-color-surface-bright: var(--color-base-200);
	--sx-color-surface-dim: var(--color-base-200);
	--sx-color-surface-container: var(--color-base-200);
	--sx-color-surface-container-low: var(--color-base-200);
	--sx-color-surface-container-high: var(--color-base-300);

	--sx-color-on-background: var(--color-base-content);
	--sx-color-on-surface: var(--color-base-content);
	--sx-color-neutral: var(--color-base-content);
	--sx-color-neutral-variant: color-mix(
		in oklch,
		var(--color-base-content) 60%,
		var(--color-base-100)
	);

	--sx-border: var(--color-base-300);
	--sx-color-outline: var(--color-base-300);
	--sx-color-outline-variant: var(--color-base-300);

	--sx-rounding-extra-small: 0.25rem;
	--sx-rounding-small: 0.375rem;
	--sx-rounding-extra-large: 0.75rem;
}
```

- [ ] **Step 3: Verify the web build**

Run:

```bash
npm --prefix web run build
```

Expected: `vue-tsc` passes and Vite builds clean. (Components still use old
`bg-accent`/`dark:` classes — that's fine; `bg-accent` resolves to the DaisyUI
accent token and `dark:` now tracks `[data-theme=dark]`.)

- [ ] **Step 4: Verify Biome tolerates the new directives**

Run:

```bash
npx biome check web/src/style.css
```

If it passes (or only warns), continue. **If it reports parse errors** on
`@plugin "daisyui/theme"`, exclude the CSS file from Biome by editing
`biome.json`'s `files` block to:

```json
	"files": {
		"ignoreUnknown": false,
		"includes": ["**", "!web/src/style.css"]
	},
```

Re-run `npx biome check web/src/style.css` → no errors (file skipped).

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/src/style.css biome.json
git commit -m "feat(webui): add DaisyUI with light/dark themes and Schedule-X token mapping"
```

---

## Task 2: Theme store (light/dark/system) and sidebar state

**Files:**
- Rewrite: `web/src/composables/useTheme.ts`
- Create: `web/src/composables/useSidebar.ts`

- [ ] **Step 1: Rewrite `web/src/composables/useTheme.ts`**

Replace the entire file with:

```ts
import { ref } from "vue";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const mql = window.matchMedia("(prefers-color-scheme: dark)");

function readStored(): ThemeMode {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v === "light" || v === "dark" || v === "system") return v;
	} catch {}
	return "system";
}

// Module-level singleton: the app has exactly one theme mode.
const mode = ref<ThemeMode>(readStored());

function resolved(): "light" | "dark" {
	if (mode.value === "system") return mql.matches ? "dark" : "light";
	return mode.value;
}

function apply() {
	document.documentElement.dataset.theme = resolved();
}

function setMode(next: ThemeMode) {
	mode.value = next;
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {}
	apply();
}

let initialized = false;

/** Apply the persisted theme and track OS changes while in system mode. */
export function initTheme() {
	if (initialized) return;
	initialized = true;
	apply();
	mql.addEventListener("change", () => {
		if (mode.value === "system") apply();
	});
}

export function useTheme() {
	return { mode, setMode };
}
```

- [ ] **Step 2: Create `web/src/composables/useSidebar.ts`**

```ts
import { ref } from "vue";

// Shared open/close state for the mobile sidebar drawer.
const isOpen = ref(false);

export function useSidebar() {
	function toggle() {
		isOpen.value = !isOpen.value;
	}
	function open() {
		isOpen.value = true;
	}
	function close() {
		isOpen.value = false;
	}
	return { isOpen, toggle, open, close };
}
```

- [ ] **Step 3: Verify build**

```bash
npm --prefix web run build
```

Expected: clean. (`main.ts` already calls `initTheme()`; the new signature is
compatible.)

- [ ] **Step 4: Commit**

```bash
git add web/src/composables/useTheme.ts web/src/composables/useSidebar.ts
git commit -m "feat(webui): theme mode store (light/dark/system) and sidebar state"
```

---

## Task 3: ThemeToggle component

**Files:**
- Create: `web/src/components/ThemeToggle.vue`

- [ ] **Step 1: Create `web/src/components/ThemeToggle.vue`**

```vue
<script setup lang="ts">
import { useTheme } from "@/composables/useTheme";

const { mode, setMode } = useTheme();

const options = [
	{ value: "light", label: "Light", icon: "☀" },
	{ value: "dark", label: "Dark", icon: "☾" },
	{ value: "system", label: "System", icon: "🖥" },
] as const;
</script>

<template>
	<div class="join">
		<button
			v-for="o in options"
			:key="o.value"
			type="button"
			class="btn btn-ghost btn-sm join-item"
			:class="{ 'btn-active text-primary': mode === o.value }"
			:title="o.label"
			:aria-pressed="mode === o.value"
			@click="setMode(o.value)"
		>
			<span aria-hidden="true">{{ o.icon }}</span>
			<span class="sr-only">{{ o.label }}</span>
		</button>
	</div>
</template>
```

- [ ] **Step 2: Verify build**

```bash
npm --prefix web run build
```

Expected: clean (component unused until Task 4 — acceptable).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ThemeToggle.vue
git commit -m "feat(webui): add ThemeToggle control"
```

---

## Task 4: App shell — DaisyUI navbar, hamburger, theme toggle

**Files:**
- Rewrite: `web/src/App.vue`

- [ ] **Step 1: Rewrite `web/src/App.vue`**

```vue
<script setup lang="ts">
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ThemeToggle from "@/components/ThemeToggle.vue";
import { useAuth } from "@/composables/useAuth";
import { useSidebar } from "@/composables/useSidebar";

const route = useRoute();
const router = useRouter();
const { logout } = useAuth();
const sidebar = useSidebar();

// Close the mobile drawer whenever the route changes.
watch(() => route.fullPath, () => sidebar.close());

const linkBase = "btn btn-ghost btn-sm";
const linkActive = "btn-active text-primary";

async function onLogout() {
	await logout();
	router.push("/pair");
}
</script>

<template>
	<div class="flex min-h-screen flex-col bg-base-100 text-base-content">
		<template v-if="route.name !== 'pair'">
			<header class="navbar min-h-0 border-b border-base-300 bg-base-100 px-2 py-1.5">
				<button
					class="btn btn-square btn-ghost btn-sm lg:hidden"
					aria-label="Toggle menu"
					@click="sidebar.toggle()"
				>
					<span aria-hidden="true" class="text-lg">☰</span>
				</button>
				<span class="flex items-center gap-2 px-2 font-semibold">
					<span class="inline-block h-4 w-4 rounded bg-primary" />
					yot
				</span>
				<nav class="ml-1 flex gap-1">
					<RouterLink to="/" :class="linkBase" :exact-active-class="linkActive">
						Calendar
					</RouterLink>
					<RouterLink to="/list" :class="linkBase" :exact-active-class="linkActive">
						List
					</RouterLink>
				</nav>
				<div class="ml-auto flex items-center gap-1">
					<ThemeToggle />
					<button class="btn btn-ghost btn-sm" @click="onLogout">Log out</button>
				</div>
			</header>
			<main class="flex min-h-0 flex-1">
				<RouterView />
			</main>
		</template>
		<RouterView v-else />
	</div>
</template>
```

- [ ] **Step 2: Verify build**

```bash
npm --prefix web run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/App.vue
git commit -m "feat(webui): DaisyUI navbar with hamburger and theme toggle"
```

---

## Task 5: Sidebar — responsive drawer + DaisyUI restyle

**Files:**
- Rewrite: `web/src/components/Sidebar.vue`

- [ ] **Step 1: Rewrite `web/src/components/Sidebar.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import type { Calendar, Tag } from "@/api/client";
import ColorPicker from "@/components/ColorPicker.vue";
import Popover from "@/components/Popover.vue";
import { useSidebar } from "@/composables/useSidebar";

const props = defineProps<{
	calendars: Calendar[];
	tags: Tag[];
	connected: boolean;
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

const { isOpen, close } = useSidebar();

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

function confirmDeleteTag(t: Tag, closePopover: () => void) {
	if (window.confirm(`Delete tag "${t.name}"? Events keep their other tags.`)) {
		emit("delete-tag", t.id);
		closePopover();
	}
}

const sectionHeader =
	"text-xs font-semibold uppercase tracking-wide text-base-content/50";
</script>

<template>
	<!-- Mobile backdrop -->
	<div
		v-if="isOpen"
		class="fixed inset-0 z-30 bg-black/40 lg:hidden"
		@click="close()"
	/>
	<aside
		class="fixed inset-y-0 left-0 z-40 flex w-72 -translate-x-full flex-col gap-6 overflow-y-auto border-r border-base-300 bg-base-100 px-3 py-4 transition-transform lg:static lg:z-auto lg:w-64 lg:translate-x-0"
		:class="{ 'translate-x-0': isOpen }"
	>
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
			<ul class="space-y-0.5">
				<li
					v-for="c in calendars"
					:key="c.id"
					class="group flex items-center gap-2 rounded-field px-2 py-1 hover:bg-base-200"
				>
					<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
						<input
							type="checkbox"
							class="checkbox checkbox-primary checkbox-sm shrink-0"
							:checked="enabledCalendarIds.has(c.id)"
							@change="emit('toggle-calendar', c.id)"
						/>
						<span
							class="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
							:style="{ background: c.color ?? 'oklch(0.7 0.04 256)' }"
						/>
						<span class="truncate text-sm">{{ c.name }}</span>
					</label>
					<Popover align="right">
						<template #trigger="{ toggle }">
							<button
								class="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100"
								aria-label="Calendar options"
								@click="toggle"
							>
								⋯
							</button>
						</template>
						<template #panel>
							<div class="space-y-3">
								<form
									class="space-y-1"
									@submit.prevent="emit('rename-calendar', c.id, renameFromForm($event))"
								>
									<span :class="sectionHeader">Rename</span>
									<div class="join w-full">
										<input name="name" :value="c.name" class="input input-sm join-item w-full" />
										<button class="btn btn-primary btn-sm join-item">✓</button>
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
						</template>
					</Popover>
				</li>
			</ul>
			<form class="join w-full pt-1" @submit.prevent="addCalendar">
				<input
					v-model="newCalName"
					placeholder="New calendar"
					class="input input-sm join-item w-full"
				/>
				<button class="btn btn-neutral btn-sm join-item">＋</button>
			</form>
		</section>

		<!-- Tags -->
		<section class="space-y-2">
			<h2 :class="sectionHeader">Tags</h2>
			<ul v-if="tags.length" class="space-y-0.5">
				<li v-for="t in tags" :key="t.id" class="group flex items-center gap-1">
					<button
						class="flex min-w-0 flex-1 items-center gap-2 rounded-full border px-2.5 py-1 text-left text-sm transition"
						:style="
							selectedTag === t.name
								? {
										background: t.color ?? 'oklch(0.45 0.03 256)',
										borderColor: t.color ?? 'oklch(0.45 0.03 256)',
										color: '#fff',
									}
								: { borderColor: t.color ?? 'var(--color-base-300)' }
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
					<Popover align="right">
						<template #trigger="{ toggle }">
							<button
								class="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100"
								aria-label="Tag options"
								@click="toggle"
							>
								⋯
							</button>
						</template>
						<template #panel="{ close: closePopover }">
							<div class="space-y-3">
								<form
									class="space-y-1"
									@submit.prevent="emit('rename-tag', t.id, renameFromForm($event))"
								>
									<span :class="sectionHeader">Rename</span>
									<div class="join w-full">
										<input name="name" :value="t.name" class="input input-sm join-item w-full" />
										<button class="btn btn-primary btn-sm join-item">✓</button>
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
									class="btn btn-error btn-outline btn-sm w-full"
									@click="confirmDeleteTag(t, closePopover)"
								>
									Delete tag
								</button>
							</div>
						</template>
					</Popover>
				</li>
			</ul>
			<p v-else class="text-xs text-base-content/40">(no tags)</p>

			<form class="space-y-2 pt-1" @submit.prevent="addTag">
				<div class="join w-full">
					<input v-model="newTagName" placeholder="New tag" class="input input-sm join-item w-full" />
					<button class="btn btn-neutral btn-sm join-item">＋</button>
				</div>
				<ColorPicker v-model="newTagColor" />
			</form>
		</section>

		<!-- Live indicator -->
		<div class="mt-auto flex items-center gap-2 text-xs">
			<span
				class="inline-block h-2 w-2 rounded-full"
				:class="connected ? 'bg-success' : 'bg-error'"
			/>
			<span class="text-base-content/60">{{ connected ? "Live" : "Offline" }}</span>
		</div>
	</aside>
</template>
```

- [ ] **Step 2: Verify build**

```bash
npm --prefix web run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Sidebar.vue
git commit -m "feat(webui): responsive sidebar drawer with DaisyUI restyle"
```

---

## Task 6: EventModal — DaisyUI restyle

**Files:**
- Rewrite: `web/src/components/EventModal.vue`

Keep all existing `<script setup>` logic exactly as-is. Only the `<template>` and
the two trailing class-constant strings change.

- [ ] **Step 1: Replace the `fieldClass`/`labelClass` constants** (near the end of `<script setup>`) with:

```ts
const fieldClass = "w-full";
const labelClass = "text-xs font-medium text-base-content/60";
```

- [ ] **Step 2: Replace the entire `<template>` block** with:

```vue
<template>
	<div
		class="modal modal-open"
		@click.self="emit('close')"
	>
		<div class="modal-box w-full max-w-md">
			<div class="mb-3 flex items-start justify-between gap-2">
				<h2 class="text-lg font-semibold">{{ title }}</h2>
				<button type="button" class="btn btn-ghost btn-sm btn-circle" @click="emit('close')">
					✕
				</button>
			</div>

			<!-- View mode -->
			<div v-if="localMode === 'view' && event" class="space-y-3">
				<div class="flex items-center gap-2 text-sm text-base-content/70">
					<span
						class="inline-block h-3 w-3 rounded-full ring-1 ring-black/10"
						:style="{ background: calendar?.color ?? 'oklch(0.7 0.04 256)' }"
					/>
					<span>{{ calendar?.name ?? "Unknown calendar" }}</span>
				</div>
				<p class="text-sm">
					{{ dateRange }}
					<span v-if="event.all_day" class="ml-1 text-xs text-base-content/50">(all day)</span>
				</p>
				<p v-if="event.location" class="text-sm">📍 {{ event.location }}</p>
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
					<button class="btn btn-primary btn-sm" @click="startEdit">Edit</button>
				</div>
			</div>

			<!-- Create / edit form -->
			<form v-else class="space-y-3" @submit.prevent="submit">
				<label class="block space-y-1">
					<span :class="labelClass">Title</span>
					<input v-model="form.title" required class="input w-full" />
				</label>
				<label class="block space-y-1">
					<span :class="labelClass">Calendar</span>
					<select v-model="form.calendar_id" required class="select w-full">
						<option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.name }}</option>
					</select>
				</label>
				<label class="flex cursor-pointer items-center gap-2 text-sm">
					<input
						v-model="form.all_day"
						type="checkbox"
						class="checkbox checkbox-primary checkbox-sm"
						@change="onAllDayToggle"
					/>
					All day
				</label>
				<div class="flex gap-2">
					<label class="block flex-1 space-y-1">
						<span :class="labelClass">Start</span>
						<input
							v-model="form.start"
							:type="form.all_day ? 'date' : 'datetime-local'"
							required
							class="input w-full"
						/>
					</label>
					<label class="block flex-1 space-y-1">
						<span :class="labelClass">End</span>
						<input
							v-model="form.end"
							:type="form.all_day ? 'date' : 'datetime-local'"
							required
							class="input w-full"
						/>
					</label>
				</div>
				<label class="block space-y-1">
					<span :class="labelClass">Location</span>
					<input v-model="form.location" class="input w-full" />
				</label>
				<label class="block space-y-1">
					<span :class="labelClass">Description</span>
					<textarea v-model="form.description" rows="3" class="textarea w-full" />
				</label>
				<div v-if="tags.length" class="space-y-1">
					<span :class="labelClass">Tags</span>
					<div class="flex flex-wrap gap-1">
						<button
							v-for="t in tags"
							:key="t.id"
							type="button"
							class="rounded-full border px-2.5 py-1 text-xs transition"
							:style="
								selectedTagIds.has(t.id)
									? {
											background: t.color ?? 'oklch(0.45 0.03 256)',
											borderColor: t.color ?? 'oklch(0.45 0.03 256)',
											color: '#fff',
										}
									: { borderColor: t.color ?? 'var(--color-base-300)' }
							"
							:class="selectedTagIds.has(t.id) ? '' : 'text-base-content/70'"
							@click="toggleTag(t.id)"
						>
							{{ t.name }}
						</button>
					</div>
				</div>

				<p v-if="error" class="text-sm text-error">{{ error }}</p>

				<div class="modal-action">
					<button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">
						Cancel
					</button>
					<button :disabled="busy" class="btn btn-primary btn-sm">
						{{ localMode === "create" ? "Create" : "Save" }}
					</button>
				</div>
			</form>
		</div>
	</div>
</template>
```

Note: `fieldClass` is now unused in the template (kept harmless, or delete the
constant). If you delete it, remove only the `const fieldClass = ...` line.

- [ ] **Step 3: Verify build**

```bash
npm --prefix web run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/EventModal.vue
git commit -m "feat(webui): restyle EventModal with DaisyUI modal and controls"
```

---

## Task 7: ColorPicker + Popover — DaisyUI token restyle

**Files:**
- Rewrite: `web/src/components/ColorPicker.vue`
- Rewrite: `web/src/components/Popover.vue`

- [ ] **Step 1: Rewrite `web/src/components/ColorPicker.vue`**

Keep the `<script setup>` (PALETTE + `onCustom`) unchanged. Replace the
`<template>` with token-aware ring colors:

```vue
<template>
	<div class="flex flex-wrap items-center gap-1.5">
		<button
			v-for="c in PALETTE"
			:key="c"
			type="button"
			class="h-6 w-6 rounded-full transition hover:scale-110"
			:class="
				modelValue === c
					? 'ring-2 ring-primary ring-offset-1 ring-offset-base-100'
					: 'ring-1 ring-base-300'
			"
			:style="{ background: c }"
			:aria-label="`Use ${c}`"
			:aria-pressed="modelValue === c"
			@click="emit('update:modelValue', c)"
		/>
		<label
			class="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full ring-1 ring-base-300"
			title="Custom color"
		>
			<span
				class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white"
				:style="{
					background:
						'conic-gradient(#ef4444,#f59e0b,#84cc16,#06b6d4,#6366f1,#ec4899,#ef4444)',
				}"
				>＋</span
			>
			<input
				type="color"
				class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
				:value="modelValue ?? '#10b981'"
				@input="onCustom"
			/>
		</label>
	</div>
</template>
```

- [ ] **Step 2: Rewrite the panel styling in `web/src/components/Popover.vue`**

Keep the `<script setup>` unchanged. Replace the floating panel `<div>`'s class
list with DaisyUI tokens:

```vue
		<div
			v-if="open"
			class="absolute top-full z-30 mt-1 min-w-48 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
			:class="align === 'right' ? 'right-0' : 'left-0'"
		>
			<slot name="panel" :close="close" />
		</div>
```

(The rest of the template — the `root` wrapper and trigger slot — is unchanged.)

- [ ] **Step 3: Verify build**

```bash
npm --prefix web run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ColorPicker.vue web/src/components/Popover.vue
git commit -m "feat(webui): restyle ColorPicker and Popover with DaisyUI tokens"
```

---

## Task 8: ListView — DaisyUI restyle + responsive toolbar

**Files:**
- Rewrite: `web/src/views/ListView.vue`

Keep the entire `<script setup>` unchanged. Replace only the `<template>` block
with:

```vue
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
		<div class="flex min-w-0 flex-1 flex-col gap-3 p-4">
			<div class="flex flex-wrap items-center gap-2">
				<div class="join">
					<input
						v-model="search"
						placeholder="Search events…"
						class="input input-sm join-item"
						@keyup.enter="refresh"
					/>
					<button class="btn btn-neutral btn-sm join-item" @click="refresh">Search</button>
				</div>
				<button class="btn btn-primary btn-sm ml-auto" @click="openCreate">
					＋ New event
				</button>
			</div>
			<ul class="divide-y divide-base-300 overflow-hidden rounded-box border border-base-300 bg-base-100">
				<li
					v-for="e in visibleEvents"
					:key="e.id"
					class="cursor-pointer px-4 py-3 transition hover:bg-base-200"
					@click="openView(e)"
				>
					<div class="flex flex-wrap items-center gap-2">
						<span
							class="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
							:style="{ background: calendarColor(e.calendar_id) }"
						/>
						<span class="font-medium">{{ e.title }}</span>
						<span class="text-sm text-base-content/60">
							{{ new Date(e.start_at).toLocaleString() }}
						</span>
						<span
							v-for="t in e.tags"
							:key="t"
							class="badge badge-sm border-0 text-white"
							:style="{ background: tagColor(t) }"
						>
							{{ t }}
						</span>
					</div>
					<p v-if="e.location" class="ml-5 mt-0.5 text-xs text-base-content/50">
						📍 {{ e.location }}
					</p>
				</li>
				<li v-if="visibleEvents.length === 0" class="px-4 py-6 text-center text-sm text-base-content/40">
					No events.
				</li>
			</ul>
		</div>
	</div>
	<EventModal
		v-if="modalMode"
		ref="modalRef"
		:key="`${modalMode}-${selected?.id ?? 'new'}`"
		:mode="modalMode"
		:event="selected"
		:calendars="calendars"
		:tags="tags"
		@close="closeModal"
		@create="onCreate"
		@save="onSave"
	/>
</template>
```

- [ ] **Step 2: Verify build**

```bash
npm --prefix web run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/ListView.vue
git commit -m "feat(webui): restyle ListView with DaisyUI"
```

---

## Task 9: CalendarView — responsive toolbar + DaisyUI button

**Files:**
- Modify: `web/src/views/CalendarView.vue`

Only the toolbar button in the `<template>` changes; all `<script setup>` and the
Schedule-X wiring stay the same.

- [ ] **Step 1: Replace the toolbar `<div>` and button** (the block containing `＋ New event`) with:

```vue
		<div class="flex min-w-0 flex-1 flex-col gap-3 p-4">
			<div class="flex items-center justify-end">
				<button class="btn btn-primary btn-sm" @click="openCreate">
					＋ New event
				</button>
			</div>
			<ScheduleXCalendar :calendar-app="calendarApp" />
		</div>
```

(The surrounding `<div class="flex w-full">`, the `<Sidebar ... />` with its
emit handlers, and the `<EventModal ... />` are unchanged.)

- [ ] **Step 2: Verify build**

```bash
npm --prefix web run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/CalendarView.vue
git commit -m "feat(webui): DaisyUI toolbar button in CalendarView"
```

---

## Task 10: PairView — DaisyUI restyle

**Files:**
- Rewrite: `web/src/views/PairView.vue`

Keep the entire `<script setup>` unchanged. Replace the `<template>` with:

```vue
<template>
	<div class="flex min-h-screen items-center justify-center bg-base-200 p-4">
		<form class="card w-80 bg-base-100 shadow-md" @submit.prevent="submit">
			<div class="card-body gap-4">
				<h1 class="text-center text-lg font-semibold">Pair this browser</h1>
				<p class="text-center text-sm text-base-content/60">
					Run <code class="rounded bg-base-200 px-1">npm run auth</code> and enter the PIN.
				</p>
				<input
					v-model="pin"
					inputmode="numeric"
					maxlength="6"
					placeholder="6-digit PIN"
					class="input w-full text-center text-2xl tracking-widest"
				/>
				<p v-if="error" class="text-sm text-error">{{ error }}</p>
				<button type="submit" :disabled="busy || pin.length < 6" class="btn btn-primary w-full">
					{{ busy ? "Pairing..." : "Pair" }}
				</button>
			</div>
		</form>
	</div>
</template>
```

- [ ] **Step 2: Verify build**

```bash
npm --prefix web run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/PairView.vue
git commit -m "feat(webui): restyle PairView with DaisyUI"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full build (backend tsc + web)**

```bash
npm run build
```

Expected: backend `tsc` clean + web `vue-tsc`/Vite clean.

- [ ] **Step 2: Biome**

```bash
npx biome check web/src src
```

Expected: no errors (one pre-existing `noNonNullAssertion` warning in
`src/mcp/relay.test.ts` is acceptable). If new style-only diffs appear, run
`npx biome check --write web/src src` and re-check.

- [ ] **Step 3: Backend sanity**

```bash
npm test
```

Expected: 66 pass, 0 fail (unchanged — no backend edits).

- [ ] **Step 4: Manual browser pass** (`npm run dev` + `npm --prefix web run dev`)

Verify each original complaint:
- **#1 light mode:** the navbar Light/Dark/System control switches theme; the
  choice persists across a page reload; in System mode, changing the OS theme
  flips the app live.
- **#2 responsive:** at phone width (DevTools device toolbar) the sidebar is
  hidden behind the ☰ hamburger, slides in over a backdrop, closes on
  backdrop tap and on navigating; navbar, modal, and toolbars fit without
  horizontal overflow.
- **#3 calendar:** the Schedule-X grid uses the theme surfaces/borders, emerald
  "today"/selection, and looks clean in both light and dark.
- **#4 contrast:** no black/unreadable text anywhere in dark mode (chrome and
  calendar); tag/calendar dots and badges remain legible.

- [ ] **Step 5: Commit any final fixes** discovered during the manual pass
  (e.g., nudged Schedule-X values), then the work is complete.

---

## Self-Review Notes

- **Spec coverage:** theme toggle (Tasks 2–4), responsive drawer (Tasks 2,4,5),
  DaisyUI restyle/contrast (Tasks 1,5–10), calendar reskin (Task 1), biome/build
  verification (Tasks 1,11). All spec sections map to tasks.
- **Deviation from spec:** the responsive sidebar uses a `useSidebar` state
  singleton + Tailwind classes instead of DaisyUI's structural `drawer`, because
  the sidebar is rendered per-view and DaisyUI's `drawer` would force relocating
  it into the shell and centralizing SSE/state — out of scope for a polish pass.
  Same user-visible behavior (slide-in on mobile, static on `lg`).
- **Type consistency:** `useTheme()` returns `{ mode, setMode }` (Task 2) and is
  consumed that way in ThemeToggle (Task 3); `useSidebar()` returns
  `{ isOpen, toggle, open, close }` (Task 2) consumed in App (Task 4) and Sidebar
  (Task 5). EventModal/ListView/CalendarView keep their existing emit contracts.
```
