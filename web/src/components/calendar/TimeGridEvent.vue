<script setup lang="ts">
import { MapPin } from "@lucide/vue";
import { computed } from "vue";
import { eventColor, type SxEvent, timeRange } from "./sx-event";

const props = defineProps<{ calendarEvent: SxEvent }>();
const color = computed(() => eventColor(props.calendarEvent));
const range = computed(() => timeRange(props.calendarEvent));
</script>

<template>
	<div
		class="flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-md border-l-2 px-1.5 py-1 text-xs leading-tight text-base-content"
		:style="{
			borderColor: color,
			background: `color-mix(in oklch, ${color} 20%, var(--color-base-100))`,
		}"
	>
		<span class="shrink-0 tabular-nums opacity-70">{{ range }}</span>
		<span class="line-clamp-2 font-semibold">{{ calendarEvent.title || "(untitled)" }}</span>
		<span
			v-if="calendarEvent.location"
			class="mt-auto flex items-center gap-0.5 truncate opacity-70"
		>
			<MapPin :size="11" aria-hidden="true" />
			<span class="truncate">{{ calendarEvent.location }}</span>
		</span>
	</div>
</template>
