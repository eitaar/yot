<script setup lang="ts">
import type { Calendar, Tag } from "@/api/client";
import FiltersPanel from "@/components/FiltersPanel.vue";
import { useSidebar } from "@/composables/useSidebar";

// Desktop-only docked, collapsible filter panel. On mobile the same
// FiltersPanel is shown inside FilterSheet instead. Filter props are passed
// through to FiltersPanel; emit handlers arrive via $attrs and are forwarded.
defineOptions({ inheritAttrs: false });

defineProps<{
	calendars: Calendar[];
	tags: Tag[];
	connected: boolean;
	pendingCount?: number;
	syncing?: boolean;
	enabledCalendarIds: Set<string>;
	selectedTag: string | null;
}>();

const { isOpen } = useSidebar();
</script>

<template>
	<aside
		class="hidden shrink-0 flex-col gap-5 overflow-y-auto bg-base-100 transition-[width] lg:flex"
		:class="isOpen ? 'w-64 border-r border-base-200 px-3 py-4' : 'w-0 overflow-hidden'"
	>
		<FiltersPanel
			:calendars="calendars"
			:tags="tags"
			:enabled-calendar-ids="enabledCalendarIds"
			:selected-tag="selectedTag"
			v-bind="$attrs"
		/>
		<div class="mt-auto space-y-1 px-1">
			<span
				class="badge badge-sm gap-1"
				:class="connected ? 'badge-success' : 'badge-error'"
			>
				{{ connected ? "Live" : "Offline" }}
			</span>
			<span v-if="syncing" class="badge badge-info badge-sm gap-1">
				Syncing…
			</span>
			<span
				v-else-if="pendingCount"
				class="badge badge-warning badge-sm gap-1"
			>
				{{ pendingCount }} pending
			</span>
		</div>
	</aside>
</template>
