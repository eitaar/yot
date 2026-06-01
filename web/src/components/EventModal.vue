<script setup lang="ts">
import { Check, ImagePlus, Link, MapPin, Pencil, Plus, X } from "@lucide/vue";
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import type { Calendar, Event, EventUpdate, Tag } from "@/api/client";
import { api, imageSrc } from "@/api/client";
import ColorPicker from "@/components/ColorPicker.vue";
import { renderMarkdown } from "@/lib/markdown";

type CreateInput = {
	calendar_id: string;
	title: string;
	start_at: string;
	end_at: string;
	all_day: boolean;
	location?: string;
	description?: string;
	url?: string;
	image_path?: string;
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

// Bottom-sheet slide animation (matches FilterSheet): the parent mounts this
// modal via v-if, so it would otherwise appear already-open and skip DaisyUI's
// modal-box slide. Instead we render closed, then flip `modal-open` on the next
// frame so the translate (.3s) transition runs. Closing waits for the
// slide-down before emitting `close`, since the parent unmounts on close.
const open = ref(false);
let closing = false;
let closeTimer: number | undefined;
function requestClose() {
	if (closing) return;
	closing = true;
	open.value = false;
	closeTimer = window.setTimeout(() => emit("close"), 300);
}

const form = reactive({
	calendar_id: "",
	title: "",
	description: "",
	location: "",
	all_day: false,
	start: "",
	end: "",
	url: "",
	image_path: null as string | null,
});
const selectedTagIds = ref(new Set<string>());

const showNewTag = ref(false);
const newTagName = ref("");
const newTagColor = ref<string | null>("#10b981");
const creatingTag = ref(false);

const imgBusy = ref(false);
const imgUrlInput = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

const calendar = computed(() =>
	props.calendars.find((c) => c.id === props.event?.calendar_id),
);

function tagColor(name: string): string {
	return props.tags.find((t) => t.name === name)?.color ?? "#64748b";
}

const renderedDescription = computed(() =>
	renderMarkdown(props.event?.description),
);

const dateRange = computed(() => {
	const e = props.event;
	if (!e) return "";
	if (e.all_day) {
		const sd = e.start_at.slice(0, 10);
		const ed = e.end_at.slice(0, 10);
		return sd === ed ? sd : `${sd} - ${ed}`;
	}
	const s = new Date(e.start_at);
	const en = new Date(e.end_at);
	const time = (d: Date) =>
		d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return `${s.toLocaleDateString()} ${time(s)} - ${time(en)}`;
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
	form.start = e.all_day
		? toDateInput(e.start_at)
		: toDateTimeInput(e.start_at);
	form.end = e.all_day ? toDateInput(e.end_at) : toDateTimeInput(e.end_at);
	form.url = e.url ?? "";
	form.image_path = e.image_path ?? null;
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
	form.url = "";
	form.image_path = null;
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

async function onPickFile(e: globalThis.Event) {
	const input = e.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;
	imgBusy.value = true;
	error.value = "";
	try {
		const { path } = await api.uploadImage(file);
		form.image_path = path;
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		imgBusy.value = false;
		if (fileInput.value) fileInput.value.value = "";
	}
}

async function onAddImageUrl() {
	const url = imgUrlInput.value.trim();
	if (!url) return;
	imgBusy.value = true;
	error.value = "";
	try {
		const { path } = await api.uploadImageFromUrl(url);
		form.image_path = path;
		imgUrlInput.value = "";
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		imgBusy.value = false;
	}
}

function removeImage() {
	form.image_path = null;
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
				...(form.url.trim() ? { url: form.url.trim() } : {}),
				...(form.image_path ? { image_path: form.image_path } : {}),
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
				url: form.url.trim() || null,
				image_path: form.image_path || null,
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
defineExpose({ setError, requestClose });

const title = computed(() =>
	localMode.value === "create"
		? "New event"
		: localMode.value === "edit"
			? "Edit event"
			: (props.event?.title ?? ""),
);

function onKey(e: KeyboardEvent) {
	if (e.key === "Escape") requestClose();
}
onMounted(() => {
	window.addEventListener("keydown", onKey);
	if (props.mode === "create") fillEmpty();
	else if (props.mode === "edit" && props.event) fillFromEvent(props.event);
	// Two frames: let the closed state paint before flipping open so the
	// modal-box translate transition actually fires.
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			open.value = true;
		}),
	);
});
onUnmounted(() => {
	window.removeEventListener("keydown", onKey);
	if (closeTimer) window.clearTimeout(closeTimer);
});
</script>

<template>
	<div
		class="modal modal-bottom sm:modal-middle"
		:class="{ 'modal-open': open }"
		@click.self="requestClose()"
	>
		<div class="modal-box max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto">
			<div class="mb-4 flex items-start justify-between gap-2">
				<h2 class="text-xl font-semibold leading-tight">{{ title }}</h2>
				<button type="button" class="btn btn-ghost btn-sm btn-circle" @click="requestClose()">
					<X :size="18" aria-hidden="true" />
					<span class="sr-only">Close</span>
				</button>
			</div>

			<!-- View mode -->
			<div v-if="localMode === 'view' && event" class="space-y-3">
				<div v-if="event.image_path" class="overflow-hidden rounded-box">
					<img :src="imageSrc(event.image_path)" alt="" class="aspect-3/2 w-full object-cover" />
				</div>
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
				<p v-if="event.url" class="flex items-center gap-1 text-sm">
					<Link :size="14" aria-hidden="true" />
					<a :href="event.url" target="_blank" rel="noopener noreferrer" class="link truncate">
						{{ event.url }}
					</a>
				</p>
				<!-- eslint-disable-next-line vue/no-v-html — sanitized by markdown-it (html:false) -->
				<div
					v-if="event.description"
					class="md text-sm leading-relaxed"
					v-html="renderedDescription"
				/>
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
					<button class="btn btn-ghost btn-sm" @click="requestClose()">Close</button>
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
					<legend class="fieldset-legend">Link</legend>
					<input v-model="form.url" type="url" placeholder="https://…" class="input w-full" />
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Description</legend>
					<textarea v-model="form.description" rows="3" class="textarea w-full" />
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Cover image</legend>
					<div v-if="form.image_path" class="relative overflow-hidden rounded-box">
						<img :src="imageSrc(form.image_path)" alt="" class="aspect-3/2 w-full object-cover" />
						<button
							type="button"
							class="btn btn-circle btn-xs absolute right-2 top-2"
							aria-label="Remove image"
							@click="removeImage"
						>
							<X :size="14" aria-hidden="true" />
						</button>
					</div>
					<div v-else class="space-y-2">
						<button
							type="button"
							class="btn btn-sm w-full gap-1"
							:disabled="imgBusy"
							@click="fileInput?.click()"
						>
							<ImagePlus :size="15" aria-hidden="true" />
							{{ imgBusy ? "Uploading…" : "Upload image" }}
						</button>
						<input
							ref="fileInput"
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif"
							class="hidden"
							@change="onPickFile"
						/>
						<div class="join w-full">
							<input
								v-model="imgUrlInput"
								placeholder="…or paste an image URL"
								class="input input-sm join-item w-full"
								@keyup.enter.prevent="onAddImageUrl"
							/>
							<button
								type="button"
								class="btn btn-sm join-item"
								:disabled="imgBusy"
								aria-label="Use image URL"
								@click="onAddImageUrl"
							>
								<Check :size="15" aria-hidden="true" />
							</button>
						</div>
					</div>
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
					<button type="button" class="btn btn-ghost btn-sm" @click="requestClose()">
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

<style scoped>
.md :deep(p) { margin: 0 0 0.5rem; }
.md :deep(ul) { list-style: disc; padding-left: 1.25rem; margin: 0 0 0.5rem; }
.md :deep(ol) { list-style: decimal; padding-left: 1.25rem; margin: 0 0 0.5rem; }
.md :deep(a) { text-decoration: underline; }
.md :deep(code) { font-family: ui-monospace, monospace; font-size: 0.85em; }
.md :deep(h1), .md :deep(h2), .md :deep(h3) { font-weight: 600; margin: 0.25rem 0; }
.md :deep(:last-child) { margin-bottom: 0; }
</style>
