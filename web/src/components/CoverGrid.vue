<script setup lang="ts">
import { Clock } from "@lucide/vue";
import { computed } from "vue";
import type { Calendar, Event } from "@/api/client";
import { imageSrc } from "@/api/client";
import {
	type CoverTier,
	coverCardLayouts,
} from "@/components/cover-card-layout";

// Cover/gallery face: an editorial landscape mosaic. The soonest event is the
// hero; information-rich events are promoted to larger cards. Each image carries
// a uniform dark mask so the white text stays readable. Events without a cover
// fall back to a gradient from their calendar colour. Today and the future,
// soonest first.
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
	coverCardLayouts(upcoming.value).map((layout, i) => ({
		event: upcoming.value[i],
		layout,
	})),
);

function calColor(id: string): string {
	return props.calendars.find((c) => c.id === id)?.color ?? "#94a3b8";
}

function mediaStyle(e: Event): Record<string, string> {
	if (e.image_path)
		return { backgroundImage: `url(${imageSrc(e.image_path)})` };
	// color-mix keeps this format-agnostic (no hex-only assumption like `${c}88`).
	const c = calColor(e.calendar_id);
	return {
		background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, var(--color-base-300)))`,
	};
}

function tierClass(tier: CoverTier): string {
	// Two footprints sharing one ~16:9 aspect: big (hero + promoted features)
	// and small (normal). The contrast is pure scale; placement of the big tiles
	// (driven by the layout jitter) breaks the grid into an organic mosaic.
	if (tier === "hero" || tier === "feature") return "col-span-2 row-span-2";
	return "col-span-1 row-span-1";
}

function titleClass(tier: CoverTier): string {
	if (tier === "hero") return "text-xl sm:text-2xl";
	if (tier === "feature") return "text-lg";
	return "text-sm";
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
		class="grid w-full auto-rows-[8.5rem] grid-flow-row-dense grid-cols-2 gap-3 pb-2 sm:auto-rows-[9.5rem] sm:grid-cols-3 sm:gap-2 lg:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6"
	>
		<button
			v-for="{ event: e, layout } in coverCards"
			:key="e.id"
			type="button"
			class="card group relative overflow-hidden rounded-box text-left shadow-md hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:transition motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99]"
			:class="tierClass(layout.tier)"
			@click="emit('open', e)"
		>
			<!-- Media: cover image, or a gradient from the calendar colour. -->
			<span
				class="absolute inset-0 bg-cover bg-center motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105"
				:style="mediaStyle(e)"
				aria-hidden="true"
			/>
			<!-- The uniform dark mask over the whole image. -->
			<span class="absolute inset-0 bg-black/45" aria-hidden="true" />

			<!-- Content, bottom-left over the mask. -->
			<div class="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 p-3 text-white sm:p-4">
				<h3 class="font-extrabold drop-shadow-sm" :class="titleClass(layout.tier)" :title="e.title">
					<span class="block" :class="layout.tier === 'hero' ? 'line-clamp-2' : 'truncate'">
						{{ e.title }}
					</span>
				</h3>

				<p class="flex items-center gap-1 text-xs font-medium text-white/85">
					<Clock :size="13" class="shrink-0 opacity-80" aria-hidden="true" />
					<span class="truncate">
						{{ when(e) }}<template v-if="e.location && layout.showLocation"> · {{ e.location }}</template>
					</span>
				</p>
			</div>
		</button>
	</div>
	<div v-else class="py-16 text-center text-sm text-base-content/50">
		No upcoming events.
	</div>
</template>
