<script setup lang="ts">
import type { Calendar } from "@/api/client";

defineProps<{ calendars: Calendar[]; connected: boolean }>();
const emit = defineEmits<{ add: [name: string]; remove: [id: string] }>();

function addCalendar(e: globalThis.Event) {
	const form = e.target as HTMLFormElement;
	const input = form.elements.namedItem("name") as HTMLInputElement;
	if (input.value.trim()) emit("add", input.value.trim());
	form.reset();
}
</script>

<template>
	<aside class="w-56 shrink-0 space-y-3">
		<div class="flex items-center gap-2 text-sm">
			<span
				class="inline-block h-2 w-2 rounded-full"
				:class="connected ? 'bg-green-500' : 'bg-red-500'"
			/>
			<span class="text-gray-500">{{ connected ? "Live" : "Offline" }}</span>
		</div>
		<h2 class="text-sm font-semibold text-gray-500">Calendars</h2>
		<ul class="space-y-1">
			<li
				v-for="c in calendars"
				:key="c.id"
				class="flex items-center justify-between rounded px-2 py-1 hover:bg-gray-100"
			>
				<span class="flex items-center gap-2">
					<span
						class="inline-block h-3 w-3 rounded-full"
						:style="{ background: c.color ?? '#999' }"
					/>
					{{ c.name }}
				</span>
				<button class="text-xs text-red-600" @click="emit('remove', c.id)">x</button>
			</li>
		</ul>
		<form class="flex gap-1" @submit.prevent="addCalendar">
			<input name="name" placeholder="New calendar" class="w-full rounded border px-2 py-1 text-sm" />
			<button class="rounded bg-gray-200 px-2 text-sm">+</button>
		</form>
	</aside>
</template>
