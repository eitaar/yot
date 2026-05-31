<script setup lang="ts">
import { computed } from "vue";
import { eventColor, type SxEvent } from "./sx-event";

const props = defineProps<{ calendarEvent: SxEvent }>();
const color = computed(() => eventColor(props.calendarEvent));
</script>

<template>
	<div
		class="flex h-full w-full items-center gap-1 overflow-hidden rounded px-1.5 text-xs font-medium text-white"
		:style="{ background: color }"
	>
		<span class="truncate">{{ calendarEvent.title || "(untitled)" }}</span>
	</div>
</template>
