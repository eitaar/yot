<script setup lang="ts">
import { computed, ref } from "vue";
import type { Calendar, Tag } from "@/api/client";
import ColorPicker from "@/components/ColorPicker.vue";
import Popover from "@/components/Popover.vue";

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

function confirmDeleteTag(t: Tag, close: () => void) {
	if (window.confirm(`Delete tag "${t.name}"? Events keep their other tags.`)) {
		emit("delete-tag", t.id);
		close();
	}
}

const sectionHeader =
	"text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
const fieldClass =
	"w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-accent focus:ring-1 focus:ring-accent dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";
const iconBtn =
	"rounded-md px-1.5 py-0.5 text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-slate-200";
</script>

<template>
	<aside
		class="flex w-56 shrink-0 flex-col gap-6 border-r border-slate-200 bg-white px-3 py-4 dark:border-slate-800 dark:bg-slate-900"
	>
		<!-- Calendars -->
		<section class="space-y-2">
			<div class="flex items-center justify-between">
				<h2 :class="sectionHeader">Calendars</h2>
				<button
					v-if="calendars.length"
					class="text-xs font-medium text-accent hover:text-accent-hover"
					@click="emit('set-all', !allEnabled)"
				>
					{{ allEnabled ? "None" : "All" }}
				</button>
			</div>
			<ul class="space-y-0.5">
				<li
					v-for="c in calendars"
					:key="c.id"
					class="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
				>
					<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
						<input
							type="checkbox"
							class="h-4 w-4 shrink-0 accent-emerald-600 dark:accent-emerald-400"
							:checked="enabledCalendarIds.has(c.id)"
							@change="emit('toggle-calendar', c.id)"
						/>
						<span
							class="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
							:style="{ background: c.color ?? '#94a3b8' }"
						/>
						<span class="truncate text-sm">{{ c.name }}</span>
					</label>
					<Popover align="right">
						<template #trigger="{ toggle }">
							<button :class="iconBtn" aria-label="Calendar options" @click="toggle">
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
									<div class="flex gap-1">
										<input name="name" :value="c.name" :class="fieldClass" />
										<button
											class="rounded-md bg-accent px-2 text-sm text-white hover:bg-accent-hover"
										>
											✓
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
						</template>
					</Popover>
				</li>
			</ul>
			<form class="flex gap-1 pt-1" @submit.prevent="addCalendar">
				<input
					v-model="newCalName"
					placeholder="New calendar"
					:class="fieldClass"
				/>
				<button
					class="shrink-0 rounded-md bg-slate-200 px-2 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
				>
					＋
				</button>
			</form>
		</section>

		<!-- Tags -->
		<section class="space-y-2">
			<h2 :class="sectionHeader">Tags</h2>
			<ul v-if="tags.length" class="space-y-0.5">
				<li
					v-for="t in tags"
					:key="t.id"
					class="group flex items-center gap-1"
				>
					<button
						class="flex min-w-0 flex-1 items-center gap-2 rounded-full border px-2.5 py-1 text-left text-sm transition"
						:style="
							selectedTag === t.name
								? {
										background: t.color ?? '#475569',
										borderColor: t.color ?? '#475569',
										color: '#fff',
									}
								: { borderColor: t.color ?? '#cbd5e1' }
						"
						:class="selectedTag === t.name ? '' : 'text-slate-700 dark:text-slate-200'"
						@click="clickTag(t.name)"
					>
						<span
							class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
							:style="{ background: t.color ?? '#94a3b8' }"
						/>
						<span class="truncate">{{ t.name }}</span>
					</button>
					<Popover align="right">
						<template #trigger="{ toggle }">
							<button :class="iconBtn" aria-label="Tag options" @click="toggle">
								⋯
							</button>
						</template>
						<template #panel="{ close }">
							<div class="space-y-3">
								<form
									class="space-y-1"
									@submit.prevent="emit('rename-tag', t.id, renameFromForm($event))"
								>
									<span :class="sectionHeader">Rename</span>
									<div class="flex gap-1">
										<input name="name" :value="t.name" :class="fieldClass" />
										<button
											class="rounded-md bg-accent px-2 text-sm text-white hover:bg-accent-hover"
										>
											✓
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
									class="w-full rounded-md border border-red-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
									@click="confirmDeleteTag(t, close)"
								>
									Delete tag
								</button>
							</div>
						</template>
					</Popover>
				</li>
			</ul>
			<p v-else class="text-xs text-slate-400 dark:text-slate-500">(no tags)</p>

			<form class="space-y-2 pt-1" @submit.prevent="addTag">
				<div class="flex gap-1">
					<input v-model="newTagName" placeholder="New tag" :class="fieldClass" />
					<button
						class="shrink-0 rounded-md bg-slate-200 px-2 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
					>
						＋
					</button>
				</div>
				<ColorPicker v-model="newTagColor" />
			</form>
		</section>

		<!-- Live indicator -->
		<div class="mt-auto flex items-center gap-2 text-xs">
			<span
				class="inline-block h-2 w-2 rounded-full"
				:class="connected ? 'bg-emerald-500' : 'bg-red-500'"
			/>
			<span class="text-slate-500 dark:text-slate-400">{{
				connected ? "Live" : "Offline"
			}}</span>
		</div>
	</aside>
</template>
