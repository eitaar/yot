<script setup lang="ts">
import { onUnmounted, ref } from "vue";

const { align = "right" } = defineProps<{ align?: "left" | "right" }>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);

function onDocClick(e: MouseEvent) {
	if (root.value && !root.value.contains(e.target as Node)) close();
}
function onKey(e: KeyboardEvent) {
	if (e.key === "Escape") close();
}

function openPanel() {
	if (open.value) return;
	open.value = true;
	document.addEventListener("mousedown", onDocClick);
	document.addEventListener("keydown", onKey);
}
function close() {
	if (!open.value) return;
	open.value = false;
	document.removeEventListener("mousedown", onDocClick);
	document.removeEventListener("keydown", onKey);
}
function toggle() {
	open.value ? close() : openPanel();
}

onUnmounted(close);
</script>

<template>
	<div ref="root" class="relative inline-flex">
		<slot name="trigger" :toggle="toggle" :open="open" />
		<div
			v-if="open"
			class="absolute top-full z-30 mt-1 min-w-48 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
			:class="align === 'right' ? 'right-0' : 'left-0'"
		>
			<slot name="panel" :close="close" />
		</div>
	</div>
</template>
