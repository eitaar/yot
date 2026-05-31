<script setup lang="ts">
import { MapPin } from "@lucide/vue";
import { computed } from "vue";
import { eventColor, type SxEvent, timeRange } from "./sx-event";

const props = defineProps<{ calendarEvent: SxEvent }>();
const color = computed(() => eventColor(props.calendarEvent));
const range = computed(() => timeRange(props.calendarEvent));
</script>

<template>
	<div class="flex w-full items-start gap-2 px-1 py-1 text-sm text-base-content">
		<span
			class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
			:style="{ background: color }"
		/>
		<div class="min-w-0 flex-1">
			<span class="block truncate font-medium">{{ calendarEvent.title || "(untitled)" }}</span>
			<span class="flex items-center gap-1 text-xs opacity-70">
				<span class="tabular-nums">{{ range }}</span>
				<template v-if="calendarEvent.location">
					<span aria-hidden="true">·</span>
					<MapPin :size="11" aria-hidden="true" />
					<span class="truncate">{{ calendarEvent.location }}</span>
				</template>
			</span>
			<span
				v-if="calendarEvent._tags?.length"
				class="mt-1 flex flex-wrap gap-1"
			>
				<span
					v-for="t in calendarEvent._tags"
					:key="t.name"
					class="h-2 w-2 rounded-full"
					:style="{ background: t.color }"
					:title="t.name"
				/>
			</span>
		</div>
	</div>
</template>
