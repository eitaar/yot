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
