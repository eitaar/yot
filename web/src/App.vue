<script setup lang="ts">
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ThemeToggle from "@/components/ThemeToggle.vue";
import { useAuth } from "@/composables/useAuth";
import { useSidebar } from "@/composables/useSidebar";

const route = useRoute();
const router = useRouter();
const { logout } = useAuth();
const sidebar = useSidebar();

// Close the mobile drawer whenever the route changes.
watch(
	() => route.fullPath,
	() => sidebar.close(),
);

const linkBase = "btn btn-ghost btn-sm";
const linkActive = "btn-active text-primary";

async function onLogout() {
	await logout();
	router.push("/pair");
}
</script>

<template>
	<div class="flex min-h-screen flex-col bg-base-100 text-base-content">
		<template v-if="route.name !== 'pair'">
			<header class="navbar min-h-0 border-b border-base-300 bg-base-100 px-2 py-1.5">
				<button
					class="btn btn-square btn-ghost btn-sm lg:hidden"
					aria-label="Toggle menu"
					@click="sidebar.toggle()"
				>
					<span aria-hidden="true" class="text-lg">☰</span>
				</button>
				<span class="flex items-center gap-2 px-2 font-semibold">
					<span class="inline-block h-4 w-4 rounded bg-primary" />
					yot
				</span>
				<nav class="ml-1 flex gap-1">
					<RouterLink to="/" :class="linkBase" :exact-active-class="linkActive">
						Calendar
					</RouterLink>
					<RouterLink to="/list" :class="linkBase" :exact-active-class="linkActive">
						List
					</RouterLink>
				</nav>
				<div class="ml-auto flex items-center gap-1">
					<ThemeToggle />
					<button class="btn btn-ghost btn-sm" @click="onLogout">Log out</button>
				</div>
			</header>
			<main class="flex min-h-0 flex-1">
				<RouterView />
			</main>
		</template>
		<RouterView v-else />
	</div>
</template>
