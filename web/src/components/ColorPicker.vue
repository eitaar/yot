<script setup lang="ts">
const { modelValue } = defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

// Shared curated palette, used for both calendars and tags.
const PALETTE = [
	"#ef4444",
	"#f97316",
	"#f59e0b",
	"#84cc16",
	"#10b981",
	"#06b6d4",
	"#3b82f6",
	"#6366f1",
	"#a855f7",
	"#ec4899",
] as const;

function onCustom(e: globalThis.Event) {
	emit("update:modelValue", (e.target as HTMLInputElement).value);
}
</script>

<template>
	<div class="flex flex-wrap items-center gap-1.5">
		<button
			v-for="c in PALETTE"
			:key="c"
			type="button"
			class="h-6 w-6 cursor-pointer rounded-full transition-colors hover:ring-2 hover:ring-primary/60"
			:class="
				modelValue === c
					? 'ring-2 ring-primary ring-offset-1 ring-offset-base-100'
					: 'ring-1 ring-base-300'
			"
			:style="{ background: c }"
			:aria-label="`Use ${c}`"
			:aria-pressed="modelValue === c"
			@click="emit('update:modelValue', c)"
		/>
		<label
			class="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full ring-1 ring-base-300"
			title="Custom color"
		>
			<span
				class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white"
				:style="{
					background:
						'conic-gradient(#ef4444,#f59e0b,#84cc16,#06b6d4,#6366f1,#ec4899,#ef4444)',
				}"
				>+</span
			>
			<input
				type="color"
				class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
				:value="modelValue ?? '#10b981'"
				@input="onCustom"
			/>
		</label>
	</div>
</template>
