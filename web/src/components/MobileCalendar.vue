<script setup lang="ts">
import { CalendarPlus, ChevronLeft, ChevronRight } from "@lucide/vue";
import { computed, ref } from "vue";
import type { Calendar, Event, Tag } from "@/api/client";

// Mobile calendar face: a month grid (colored dots per day) or a week strip,
// with the selected day's events listed below. Desktop uses Schedule-X.
const props = defineProps<{
	events: Event[];
	calendars: Calendar[];
	tags: Tag[];
}>();
const emit = defineEmits<{
	open: [event: Event];
	create: [prefill: { start: string; end: string; all_day: boolean }];
}>();

const pad = (n: number) => String(n).padStart(2, "0");
function dayKey(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}
function addDays(d: Date, n: number): Date {
	const x = startOfDay(d);
	x.setDate(x.getDate() + n);
	return x;
}
function addMonths(d: Date, n: number): Date {
	const x = startOfDay(d);
	x.setDate(1);
	x.setMonth(x.getMonth() + n);
	return x;
}
function startOfWeek(d: Date): Date {
	const x = startOfDay(d);
	x.setDate(x.getDate() - x.getDay());
	return x;
}

const view = ref<"month" | "week">("month");
const cursor = ref(startOfDay(new Date()));
const selected = ref(startOfDay(new Date()));

const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];

const byDay = computed(() => {
	const m = new Map<string, Event[]>();
	for (const e of props.events) {
		const k = dayKey(new Date(e.start_at));
		const arr = m.get(k);
		if (arr) arr.push(e);
		else m.set(k, [e]);
	}
	for (const arr of m.values()) {
		arr.sort((a, b) => a.start_at.localeCompare(b.start_at));
	}
	return m;
});

const monthDays = computed(() => {
	const first = new Date(
		cursor.value.getFullYear(),
		cursor.value.getMonth(),
		1,
	);
	const last = new Date(
		cursor.value.getFullYear(),
		cursor.value.getMonth() + 1,
		0,
	);
	const start = startOfWeek(first);
	const end = addDays(startOfWeek(last), 6);
	const days: Date[] = [];
	for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
	return days;
});

const weekDays = computed(() => {
	const start = startOfWeek(cursor.value);
	return Array.from({ length: 7 }, (_, i) => addDays(start, i));
});

const periodLabel = computed(() =>
	cursor.value.toLocaleDateString([], { month: "long", year: "numeric" }),
);

const selectedLabel = computed(() =>
	selected.value.toLocaleDateString([], {
		weekday: "long",
		month: "short",
		day: "numeric",
	}),
);

const selectedEvents = computed(
	() => byDay.value.get(dayKey(selected.value)) ?? [],
);

function calColor(id: string): string {
	return props.calendars.find((c) => c.id === id)?.color ?? "#94a3b8";
}

function dotsFor(d: Date): string[] {
	const evs = byDay.value.get(dayKey(d)) ?? [];
	return evs.slice(0, 3).map((e) => calColor(e.calendar_id));
}

function isToday(d: Date): boolean {
	return dayKey(d) === dayKey(new Date());
}
function isSelected(d: Date): boolean {
	return dayKey(d) === dayKey(selected.value);
}
function inCursorMonth(d: Date): boolean {
	return d.getMonth() === cursor.value.getMonth();
}

function eventTime(e: Event): string {
	if (e.all_day) return "All day";
	return new Date(e.start_at).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function prev() {
	cursor.value =
		view.value === "month"
			? addMonths(cursor.value, -1)
			: addDays(cursor.value, -7);
}
function next() {
	cursor.value =
		view.value === "month"
			? addMonths(cursor.value, 1)
			: addDays(cursor.value, 7);
}
function goToday() {
	const t = startOfDay(new Date());
	cursor.value = t;
	selected.value = t;
}
function selectDay(d: Date) {
	selected.value = startOfDay(d);
}
function setView(v: "month" | "week") {
	view.value = v;
	cursor.value = startOfDay(selected.value);
}
function addOnSelected() {
	const k = dayKey(selected.value);
	emit("create", { start: k, end: k, all_day: true });
}
</script>

<template>
	<div class="flex flex-col gap-3 pb-2">
		<!-- View toggle + nav -->
		<div class="flex items-center justify-between gap-2">
			<div class="join">
				<button
					type="button"
					class="btn btn-xs join-item"
					:class="view === 'month' ? 'btn-primary' : 'btn-ghost'"
					@click="setView('month')"
				>
					Month
				</button>
				<button
					type="button"
					class="btn btn-xs join-item"
					:class="view === 'week' ? 'btn-primary' : 'btn-ghost'"
					@click="setView('week')"
				>
					Week
				</button>
			</div>
			<button type="button" class="btn btn-ghost btn-xs text-primary" @click="goToday">
				Today
			</button>
		</div>

		<div class="flex items-center justify-between">
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-circle"
				aria-label="Previous"
				@click="prev"
			>
				<ChevronLeft :size="18" aria-hidden="true" />
			</button>
			<h2 class="text-xl font-semibold">{{ periodLabel }}</h2>
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-circle"
				aria-label="Next"
				@click="next"
			>
				<ChevronRight :size="18" aria-hidden="true" />
			</button>
		</div>

		<!-- Weekday header -->
		<div class="grid grid-cols-7 text-center text-xs text-base-content/40">
			<span v-for="(w, i) in weekdayLabels" :key="i" class="py-1">{{ w }}</span>
		</div>

		<!-- Month grid -->
		<div v-if="view === 'month'" class="grid grid-cols-7 gap-1">
			<button
				v-for="d in monthDays"
				:key="dayKey(d)"
				type="button"
				class="flex aspect-square flex-col items-center gap-1 rounded-field pt-1.5 text-sm transition-colors"
				:class="[
					isSelected(d) ? 'bg-primary text-primary-content' : 'hover:bg-base-200',
					!inCursorMonth(d) && !isSelected(d) ? 'text-base-content/30' : '',
					isToday(d) && !isSelected(d) ? 'font-bold text-primary' : '',
				]"
				@click="selectDay(d)"
			>
				<span>{{ d.getDate() }}</span>
				<span class="flex h-1.5 gap-0.5">
					<span
						v-for="(c, i) in dotsFor(d)"
						:key="i"
						class="h-1 w-1 rounded-full"
						:style="{ background: isSelected(d) ? 'currentColor' : c }"
					/>
				</span>
			</button>
		</div>

		<!-- Week strip -->
		<div v-else class="grid grid-cols-7 gap-1">
			<button
				v-for="d in weekDays"
				:key="dayKey(d)"
				type="button"
				class="flex flex-col items-center gap-1 rounded-field py-2 text-sm transition-colors"
				:class="[
					isSelected(d) ? 'bg-primary text-primary-content' : 'hover:bg-base-200',
					isToday(d) && !isSelected(d) ? 'font-bold text-primary' : '',
				]"
				@click="selectDay(d)"
			>
				<span>{{ d.getDate() }}</span>
				<span class="flex h-1.5 gap-0.5">
					<span
						v-for="(c, i) in dotsFor(d)"
						:key="i"
						class="h-1 w-1 rounded-full"
						:style="{ background: isSelected(d) ? 'currentColor' : c }"
					/>
				</span>
			</button>
		</div>

		<!-- Selected day's events -->
		<section class="mt-1">
			<h3 class="px-1 pb-1 text-base font-semibold text-base-content/80">
				{{ selectedLabel }}
			</h3>
			<ul v-if="selectedEvents.length" class="flex flex-col divide-y divide-base-200">
				<li v-for="e in selectedEvents" :key="e.id">
					<button
						type="button"
						class="flex w-full items-stretch gap-3 rounded-field px-1 py-2.5 text-left transition-colors hover:bg-base-200 active:scale-[0.99]"
						@click="emit('open', e)"
					>
						<span
							class="w-1 shrink-0 rounded-full"
							:style="{ background: calColor(e.calendar_id) }"
							aria-hidden="true"
						/>
						<span class="flex min-w-0 flex-1 items-center justify-between gap-2 py-0.5">
							<span class="truncate font-medium">{{ e.title }}</span>
							<span class="shrink-0 text-xs tabular-nums text-base-content/60">
								{{ eventTime(e) }}
							</span>
						</span>
					</button>
				</li>
			</ul>
			<button
				v-else
				type="button"
				class="flex w-full items-center justify-center gap-2 rounded-field py-6 text-sm text-base-content/50 transition-colors hover:bg-base-200"
				@click="addOnSelected"
			>
				<CalendarPlus :size="16" aria-hidden="true" />
				No events - add one
			</button>
		</section>
	</div>
</template>
