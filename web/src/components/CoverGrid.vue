<script setup lang="ts">
import { computed } from "vue";
import type { Calendar, Event } from "@/api/client";
import { imageSrc } from "@/api/client";

// Cover/gallery face: 3:2 cards with the image as background and the text
// floating on top (no panel). Events without a cover fall back to a gradient
// from their calendar color. Shows today and the future, soonest first.
const props = defineProps<{ events: Event[]; calendars: Calendar[] }>();
const emit = defineEmits<{ open: [event: Event] }>();

const pad = (n: number) => String(n).padStart(2, "0");
function dayKey(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const upcoming = computed(() => {
	const now = new Date();
	const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	return [...props.events]
		.sort((a, b) => a.start_at.localeCompare(b.start_at))
		.filter((e) => dayKey(e.start_at) >= todayKey);
});

function calColor(id: string): string {
	return props.calendars.find((c) => c.id === id)?.color ?? "#94a3b8";
}

function cardStyle(e: Event): Record<string, string> {
	if (e.image_path) {
		return {
			backgroundImage: `url(${imageSrc(e.image_path)})`,
			backgroundSize: "cover",
			backgroundPosition: "center",
		};
	}
	// color-mix keeps this format-agnostic (no hex-only assumption like `${c}88`).
	const c = calColor(e.calendar_id);
	return {
		background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, transparent))`,
	};
}

function when(e: Event): string {
	const d = new Date(e.start_at);
	const date = d.toLocaleDateString([], {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
	if (e.all_day) return `${date} · All day`;
	return `${date} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}
</script>

<template>
	<div
		v-if="upcoming.length"
		class="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-3 lg:grid-cols-4"
	>
		<button
			v-for="e in upcoming"
			:key="e.id"
			type="button"
			class="relative aspect-3/2 overflow-hidden rounded-xl text-left transition-transform active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
			:style="cardStyle(e)"
			@click="emit('open', e)"
		>
			<span
				class="absolute inset-x-3 bottom-2.5 text-white"
				style="text-shadow: 0 1px 6px rgba(0,0,0,.7), 0 1px 2px rgba(0,0,0,.6)"
			>
				<span class="block truncate text-base font-extrabold leading-tight">{{ e.title }}</span>
				<span class="mt-0.5 block text-xs opacity-95">{{ when(e) }}</span>
			</span>
		</button>
	</div>
	<div v-else class="py-16 text-center text-sm text-base-content/50">
		No upcoming events.
	</div>
</template>
