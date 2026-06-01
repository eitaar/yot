<script setup lang="ts">
import { CalendarDays, Images, List, LogOut, Menu, Upload } from "@lucide/vue";
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BottomDock from "@/components/BottomDock.vue";
import ImportIcsDialog from "@/components/ImportIcsDialog.vue";
import PWAInstallButton from "@/components/PWAInstallButton.vue";
import ThemeToggle from "@/components/ThemeToggle.vue";
import { useAuth } from "@/composables/useAuth";
import { useImport } from "@/composables/useImport";
import { useIsDesktop } from "@/composables/useMediaQuery";
import { useSidebar } from "@/composables/useSidebar";

const route = useRoute();
const router = useRouter();
const { logout } = useAuth();
const sidebar = useSidebar();
const isDesktop = useIsDesktop();
const imp = useImport();

// On mobile the sidebar is an overlay → close it on navigation. On desktop it's
// a docked panel, so leave it as the user set it.
watch(
	() => route.fullPath,
	() => {
		if (!isDesktop.value) sidebar.close();
	},
);

const linkBase = "btn btn-ghost btn-sm gap-1 px-2";
const linkActive = "btn-active text-primary";

async function onLogout() {
	await logout();
	router.push("/pair");
}
</script>

<template>
	<div class="flex min-h-screen flex-col bg-base-100 text-base-content">
		<template v-if="route.name !== 'pair'">
			<header class="navbar min-h-0 border-b border-base-200 bg-base-100 px-2 py-1.5">
				<button
					class="btn btn-square btn-ghost btn-sm hidden lg:inline-flex"
					aria-label="Toggle sidebar"
					:aria-expanded="sidebar.isOpen.value"
					@click="sidebar.toggle()"
				>
					<Menu :size="18" aria-hidden="true" />
				</button>
				<span class="flex items-center gap-2 px-2 lg:px-2">
					<span class="inline-block h-4 w-4 rounded bg-primary" />
					<span class="text-xl font-semibold leading-none">yot</span>
				</span>
				<!-- Desktop top-nav; on mobile these live in the bottom dock. -->
				<nav class="ml-1 hidden gap-1 lg:flex">
					<RouterLink to="/" :class="linkBase" :exact-active-class="linkActive">
						<CalendarDays :size="16" aria-hidden="true" />
						<span>Calendar</span>
					</RouterLink>
					<RouterLink to="/list" :class="linkBase" :exact-active-class="linkActive">
						<List :size="16" aria-hidden="true" />
						<span>List</span>
					</RouterLink>
					<RouterLink to="/cover" :class="linkBase" :exact-active-class="linkActive">
						<Images :size="16" aria-hidden="true" />
						<span>Cover</span>
					</RouterLink>
				</nav>
				<div class="ml-auto hidden items-center gap-1 lg:flex">
					<button class="btn btn-ghost btn-sm gap-1 px-2" @click="imp.open()">
						<Upload :size="16" aria-hidden="true" />
						<span>Import</span>
					</button>
					<PWAInstallButton />
					<ThemeToggle />
					<button class="btn btn-ghost btn-sm gap-1 px-2" @click="onLogout">
						<LogOut :size="16" aria-hidden="true" />
						<span>Log out</span>
					</button>
				</div>
			</header>
			<main
				class="flex min-h-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0"
			>
				<RouterView />
			</main>
			<BottomDock />
		</template>
		<RouterView v-else />
		<ImportIcsDialog v-if="imp.isOpen.value && route.name !== 'pair'" @close="imp.close()" />
	</div>
</template>
