<script setup lang="ts">
import { computed } from "vue";
import type { Calendar, Tag } from "@/api/client";

const props = defineProps<{
	calendars: Calendar[];
	connected: boolean;
	tags: Tag[];
	enabledCalendarIds: Set<string>;
	selectedTag: string | null;
}>();
const emit = defineEmits<{
	add: [name: string];
	remove: [id: string];
	"toggle-calendar": [id: string];
	"set-all": [enabled: boolean];
	"select-tag": [name: string | null];
}>();

const allEnabled = computed(
	() =>
		props.calendars.length > 0 &&
		props.calendars.every((c) => props.enabledCalendarIds.has(c.id)),
);

function addCalendar(e: globalThis.Event) {
	const form = e.target as HTMLFormElement;
	const input = form.elements.namedItem("name") as HTMLInputElement;
	if (input.value.trim()) emit("add", input.value.trim());
	form.reset();
}

function clickTag(name: string) {
	emit("select-tag", props.selectedTag === name ? null : name);
}
</script>

<template>
	<aside class="w-56 shrink-0 space-y-4">
		<div class="flex items-center gap-2 text-sm">
			<span
				class="inline-block h-2 w-2 rounded-full"
				:class="connected ? 'bg-green-500' : 'bg-red-500'"
			/>
			<span class="text-gray-500">{{ connected ? "Live" : "Offline" }}</span>
		</div>

		<section class="space-y-2">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold text-gray-500">Calendars</h2>
				<button
					v-if="calendars.length"
					class="text-xs text-blue-600 hover:underline"
					@click="emit('set-all', !allEnabled)"
				>
					{{ allEnabled ? "Select none" : "Select all" }}
				</button>
			</div>
			<ul class="space-y-1">
				<li
					v-for="c in calendars"
					:key="c.id"
					class="group flex items-center justify-between rounded px-2 py-1 hover:bg-gray-100"
				>
					<label class="flex min-w-0 flex-1 items-center gap-2">
						<input
							type="checkbox"
							:checked="enabledCalendarIds.has(c.id)"
							@change="emit('toggle-calendar', c.id)"
						/>
						<span
							class="inline-block h-3 w-3 shrink-0 rounded-full"
							:style="{ background: c.color ?? '#999' }"
						/>
						<span class="truncate">{{ c.name }}</span>
					</label>
					<button
						class="ml-1 text-xs text-red-600 opacity-0 group-hover:opacity-100"
						@click="emit('remove', c.id)"
					>
						x
					</button>
				</li>
			</ul>
			<form class="flex gap-1" @submit.prevent="addCalendar">
				<input
					name="name"
					placeholder="New calendar"
					class="w-full rounded border px-2 py-1 text-sm"
				/>
				<button class="rounded bg-gray-200 px-2 text-sm">+</button>
			</form>
		</section>

		<section class="space-y-2">
			<h2 class="text-sm font-semibold text-gray-500">Tags</h2>
			<div v-if="tags.length" class="flex flex-wrap gap-1">
				<button
					v-for="t in tags"
					:key="t.id"
					class="rounded-full border px-2 py-0.5 text-xs"
					:style="
						selectedTag === t.name
							? { background: t.color ?? '#444', borderColor: t.color ?? '#444', color: '#fff' }
							: { borderColor: t.color ?? '#ccc', color: t.color ?? '#555' }
					"
					@click="clickTag(t.name)"
				>
					{{ t.name }}
				</button>
			</div>
			<p v-else class="text-xs text-gray-400">(no tags)</p>
		</section>
	</aside>
</template>
