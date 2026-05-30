<script setup lang="ts">
import { useRoute } from "vue-router";
import { useAuth } from "@/composables/useAuth";

const route = useRoute();
const { logout } = useAuth();
</script>

<template>
	<div class="min-h-screen bg-gray-50 text-gray-900">
		<header
			v-if="route.name !== 'pair'"
			class="flex items-center gap-4 border-b bg-white px-4 py-3"
		>
			<h1 class="text-lg font-semibold">Calendar</h1>
			<nav class="flex gap-2">
				<RouterLink
					to="/"
					class="rounded px-3 py-1 hover:bg-gray-100"
					active-class="bg-gray-200"
					>Calendar</RouterLink
				>
				<RouterLink
					to="/list"
					class="rounded px-3 py-1 hover:bg-gray-100"
					active-class="bg-gray-200"
					>List</RouterLink
				>
			</nav>
			<button
				class="ml-auto rounded px-3 py-1 text-sm hover:bg-gray-100"
				@click="logout().then(() => $router.push('/pair'))"
			>
				Log out
			</button>
		</header>
		<main class="p-4">
			<RouterView />
		</main>
	</div>
</template>
