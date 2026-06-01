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
	"text-xs font-semibold uppercase tracking-wide text-base-content/60";
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
