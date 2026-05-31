<script setup lang="ts">
import { computed } from "vue";
import { eventColor, formatTime, type SxEvent } from "./sx-event";

const props = defineProps<{ calendarEvent: SxEvent }>();
const color = computed(() => eventColor(props.calendarEvent));
const time = computed(() =>
	props.calendarEvent._allDay ? "" : formatTime(props.calendarEvent.start),
);
</script>

<template>
	<div
		class="flex h-full w-full items-center gap-1 overflow-hidden rounded-[0.3rem] px-1 text-xs leading-tight text-base-content"
		:style="{ background: `color-mix(in oklch, ${color} 16%, transparent)` }"
	>
		<span
			class="h-3 w-[3px] shrink-0 rounded-full"
			:style="{ background: color }"
		/>
		<span v-if="time" class="shrink-0 tabular-nums opacity-60">{{ time }}</span>
		<span class="truncate font-medium">{{ calendarEvent.title || "(untitled)" }}</span>
	</div>
</template>
