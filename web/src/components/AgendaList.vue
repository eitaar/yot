<script setup lang="ts">
import { MapPin } from "@lucide/vue";
import { computed } from "vue";
import type { Calendar, Event, Tag } from "@/api/client";

// Mobile-first calendar face: a scrollable schedule grouped by day with large
// tap targets. Desktop uses the Schedule-X grid instead (see CalendarView).
const props = defineProps<{
	events: Event[];
	calendars: Calendar[];
	tags: Tag[];
}>();
const emit = defineEmits<{ open: [event: Event] }>();

const pad = (n: number) => String(n).padStart(2, "0");

function dayKey(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(key: string): string {
	const [y, m, d] = key.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
	const rel =
		diff === 0
			? "Today"
			: diff === 1
				? "Tomorrow"
				: diff === -1
					? "Yesterday"
					: "";
	const full = date.toLocaleDateString([], {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
	return rel ? `${rel} · ${full}` : full;
}

const groups = computed(() => {
	const sorted = [...props.events].sort((a, b) =>
		a.start_at.localeCompare(b.start_at),
	);
	const map = new Map<string, Event[]>();
	for (const e of sorted) {
		const k = dayKey(e.start_at);
		const arr = map.get(k);
		if (arr) arr.push(e);
		else map.set(k, [e]);
	}
	return [...map.entries()].map(([key, events]) => ({
		key,
		label: dayLabel(key),
		events,
	}));
});

function calColor(id: string): string {
	return props.calendars.find((c) => c.id === id)?.color ?? "#94a3b8";
}
function tagColor(name: string): string {
	return props.tags.find((t) => t.name === name)?.color ?? "#64748b";
}
function eventTime(e: Event): string {
	if (e.all_day) return "All day";
	return new Date(e.start_at).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
}
</script>

<template>
	<div v-if="groups.length" class="flex flex-col gap-3 pb-2">
		<section v-for="g in groups" :key="g.key">
			<h2
				class="sticky top-0 z-10 bg-base-100/95 px-1 py-2 text-base font-semibold text-base-content/80 backdrop-blur"
			>
				{{ g.label }}
			</h2>
			<ul class="flex flex-col divide-y divide-base-200">
				<li v-for="e in g.events" :key="e.id">
					<button
						type="button"
						class="flex w-full items-stretch gap-3 rounded-field px-1 py-2.5 text-left transition-colors hover:bg-base-200 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
						@click="emit('open', e)"
					>
						<span
							class="w-1 shrink-0 rounded-full"
							:style="{ background: calColor(e.calendar_id) }"
							aria-hidden="true"
						/>
						<span class="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
							<span class="flex items-center justify-between gap-2">
								<span class="truncate font-medium">{{ e.title }}</span>
								<span class="shrink-0 text-xs tabular-nums text-base-content/60">
									{{ eventTime(e) }}
								</span>
							</span>
							<span
								v-if="e.location"
								class="flex items-center gap-1 truncate text-xs text-base-content/50"
							>
								<MapPin :size="12" aria-hidden="true" />
								<span class="truncate">{{ e.location }}</span>
							</span>
							<span v-if="e.tags.length" class="flex flex-wrap gap-1 pt-0.5">
								<span
									v-for="t in e.tags"
									:key="t"
									class="h-2 w-2 rounded-full"
									:style="{ background: tagColor(t) }"
									:title="t"
								/>
							</span>
						</span>
					</button>
				</li>
			</ul>
		</section>
	</div>
	<div v-else class="py-16 text-center text-sm text-base-content/50">
		No upcoming events.
	</div>
</template>
