<script setup lang="ts">
import { useTheme } from "@/composables/useTheme";

const { mode, setMode } = useTheme();

const options = [
	{ value: "light", label: "Light", icon: "☀" },
	{ value: "dark", label: "Dark", icon: "☾" },
	{ value: "system", label: "System", icon: "🖥" },
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
			<span aria-hidden="true">{{ o.icon }}</span>
			<span class="sr-only">{{ o.label }}</span>
		</button>
	</div>
</template>
