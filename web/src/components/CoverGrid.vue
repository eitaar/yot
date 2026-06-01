<script setup lang="ts">
import { computed } from "vue";
import type { Calendar, Event } from "@/api/client";
import { imageSrc } from "@/api/client";
import { coverCardLayout } from "@/components/cover-card-layout";

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

const coverCards = computed(() =>
	upcoming.value.map((event, index) => ({
		event,
		layout: coverCardLayout(event, index),
	})),
);

function calColor(id: string): string {
	return props.calendars.find((c) => c.id === id)?.color ?? "#94a3b8";
}

function mediaStyle(e: Event): Record<string, string> {
	if (e.image_path) {
		return {
			backgroundImage: `url(${imageSrc(e.image_path)})`,
		};
	}
	// color-mix keeps this format-agnostic (no hex-only assumption like `${c}88`).
	const c = calColor(e.calendar_id);
	return {
		background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, var(--color-base-300)))`,
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

function calendarName(id: string): string {
	return props.calendars.find((c) => c.id === id)?.name ?? "Calendar";
}
</script>

<template>
	<div
		v-if="upcoming.length"
		class="grid auto-rows-[8.5rem] grid-cols-2 gap-3 pb-2 sm:auto-rows-[9rem] sm:grid-cols-4 xl:grid-cols-6"
	>
		<button
			v-for="{ event: e, layout } in coverCards"
			:key="e.id"
			type="button"
			class="card group relative overflow-hidden rounded-box border border-base-300/60 bg-base-200 text-left shadow-sm transition-colors duration-200 hover:border-primary/60 hover:shadow-md active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
			:class="layout.className"
			@click="emit('open', e)"
		>
			<span
				class="absolute inset-0 bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.03]"
				:style="mediaStyle(e)"
				aria-hidden="true"
			/>
			<span
				class="absolute inset-0 bg-black/50"
				aria-hidden="true"
			/>
			<span
				class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/35 to-transparent"
				aria-hidden="true"
			/>
			<span
				class="card-body relative z-10 justify-end p-3 text-white sm:p-4"
			>
				<span class="flex min-w-0 items-center gap-2">
					<span
						v-if="layout.showDetails"
						class="badge badge-sm border-0 bg-white/20 text-white backdrop-blur-sm"
					>
						{{ calendarName(e.calendar_id) }}
					</span>
					<span
						v-if="e.tags.length && layout.importance === 'feature'"
						class="badge badge-sm border-0 bg-primary text-primary-content"
					>
						{{ e.tags[0] }}
					</span>
				</span>
				<span
					class="block truncate font-extrabold leading-tight"
					:class="
						layout.importance === 'feature'
							? 'text-2xl'
							: layout.importance === 'standard'
								? 'text-lg'
								: 'text-sm'
					"
				>
					{{ e.title }}
				</span>
				<span
					class="block text-xs font-medium text-white/90"
					:class="{ 'line-clamp-2': layout.showDetails }"
				>
					{{ when(e) }}
					<span v-if="e.location && layout.showDetails">
						· {{ e.location }}
					</span>
				</span>
			</span>
		</button>
	</div>
	<div v-else class="py-16 text-center text-sm text-base-content/50">
		No upcoming events.
	</div>
</template>
