<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { useAuth } from "@/composables/useAuth";

const route = useRoute();
const router = useRouter();
const { logout } = useAuth();

const linkBase =
	"rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";
const linkActive = "bg-accent/10 text-accent dark:bg-accent/15";

async function onLogout() {
	await logout();
	router.push("/pair");
}
</script>

<template>
	<div
		class="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
	>
		<template v-if="route.name !== 'pair'">
			<header
				class="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900"
			>
				<span class="flex items-center gap-2 font-semibold">
					<span class="inline-block h-4 w-4 rounded-md bg-accent" />
					yot
				</span>
				<nav class="ml-2 flex gap-1">
					<RouterLink to="/" :class="linkBase" :exact-active-class="linkActive">
						Calendar
					</RouterLink>
					<RouterLink to="/list" :class="linkBase" :exact-active-class="linkActive">
						List
					</RouterLink>
				</nav>
				<button
					class="ml-auto rounded-md px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
					@click="onLogout"
				>
					Log out
				</button>
			</header>
			<main class="flex min-h-0 flex-1">
				<RouterView />
			</main>
		</template>
		<RouterView v-else />
	</div>
</template>
