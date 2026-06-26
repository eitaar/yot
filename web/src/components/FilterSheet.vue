<script setup lang="ts">
import { X } from "@lucide/vue";
import type { Calendar, Tag } from "@/api/client";
import FiltersPanel from "@/components/FiltersPanel.vue";
import { useFilterSheet } from "@/composables/useFilterSheet";

// Mobile filter/management surface: a bottom sheet wrapping FiltersPanel.
// Emit handlers arrive via $attrs and are forwarded to FiltersPanel.
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

const { isOpen, close } = useFilterSheet();
</script>

<template>
	<div
		class="modal modal-bottom lg:hidden"
		:class="{ 'modal-open': isOpen }"
		@click.self="close()"
	>
		<div class="modal-box max-h-[85dvh] pb-[calc(1rem+env(safe-area-inset-bottom))]">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-xl font-semibold">Filters</h2>
				<div class="flex items-center gap-2">
					<span v-if="syncing" class="badge badge-info badge-sm gap-1">
						Syncing…
					</span>
					<span
						v-else-if="pendingCount"
						class="badge badge-warning badge-sm gap-1"
					>
						{{ pendingCount }} pending
					</span>
					<span
						class="badge badge-sm gap-1"
						:class="connected ? 'badge-success' : 'badge-error'"
					>
						{{ connected ? "Live" : "Offline" }}
					</span>
					<button type="button" class="btn btn-ghost btn-sm btn-circle" @click="close()">
						<X :size="18" aria-hidden="true" />
						<span class="sr-only">Close</span>
					</button>
				</div>
			</div>
			<FiltersPanel
				:calendars="calendars"
				:tags="tags"
				:enabled-calendar-ids="enabledCalendarIds"
				:selected-tag="selectedTag"
				v-bind="$attrs"
			/>
		</div>
	</div>
</template>
