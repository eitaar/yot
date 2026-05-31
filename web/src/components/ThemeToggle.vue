<script setup lang="ts">
import { Monitor, Moon, Sun } from "@lucide/vue";
import { useTheme } from "@/composables/useTheme";

const { mode, setMode } = useTheme();

const options = [
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
	{ value: "system", label: "System", icon: Monitor },
] as const;
</script>

<template>
	<div class="join">
		<button
			v-for="o in options"
			:key="o.value"
			type="button"
			class="btn btn-ghost btn-sm join-item"
			:class="{ 'btn-active text-primary': mode === o.value }"
			:title="o.label"
			:aria-pressed="mode === o.value"
			@click="setMode(o.value)"
		>
			<component :is="o.icon" :size="15" aria-hidden="true" />
			<span class="sr-only">{{ o.label }}</span>
		</button>
	</div>
</template>
