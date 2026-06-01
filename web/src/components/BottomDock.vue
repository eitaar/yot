<script setup lang="ts">
import { CalendarDays, Images, List, LogOut, MoreHorizontal, Upload } from "@lucide/vue";
import { useRoute, useRouter } from "vue-router";
import PWAInstallButton from "@/components/PWAInstallButton.vue";
import ThemeToggle from "@/components/ThemeToggle.vue";
import { useAuth } from "@/composables/useAuth";
import { useImport } from "@/composables/useImport";

// Mobile-only bottom navigation: primary destinations + an overflow menu for
// theme / install / logout. Hidden at lg and up.
const route = useRoute();
const router = useRouter();
const { logout } = useAuth();
const imp = useImport();

function isActive(name: string): boolean {
	return route.name === name;
}

async function onLogout() {
	await logout();
	router.push("/pair");
}
</script>

<template>
	<nav
		class="dock dock-sm z-40 border-t border-base-300 bg-base-100 lg:hidden"
		style="padding-bottom: env(safe-area-inset-bottom)"
	>
		<RouterLink to="/" :class="{ 'dock-active text-primary': isActive('calendar') }">
			<CalendarDays :size="20" aria-hidden="true" />
			<span class="dock-label">Calendar</span>
		</RouterLink>

		<RouterLink to="/list" :class="{ 'dock-active text-primary': isActive('list') }">
			<List :size="20" aria-hidden="true" />
			<span class="dock-label">List</span>
		</RouterLink>

		<RouterLink to="/cover" :class="{ 'dock-active text-primary': isActive('cover') }">
			<Images :size="20" aria-hidden="true" />
			<span class="dock-label">Cover</span>
		</RouterLink>

		<div class="dropdown dropdown-top dropdown-end">
			<div
				tabindex="0"
				role="button"
				class="flex flex-col items-center justify-center gap-0.5"
				aria-label="More"
			>
				<MoreHorizontal :size="20" aria-hidden="true" />
				<span class="dock-label">More</span>
			</div>
			<div
				tabindex="0"
				class="dropdown-content mb-3 w-52 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
			>
				<div class="space-y-3">
					<div class="space-y-1">
						<span class="text-xs font-semibold uppercase tracking-wide text-base-content/50">
							Theme
						</span>
						<ThemeToggle />
					</div>
					<PWAInstallButton class="w-full" />
					<button class="btn btn-ghost btn-sm w-full justify-start gap-2" @click="imp.open()">
						<Upload :size="16" aria-hidden="true" />
						Import .ics
					</button>
					<button class="btn btn-ghost btn-sm w-full justify-start gap-2" @click="onLogout">
						<LogOut :size="16" aria-hidden="true" />
						Log out
					</button>
				</div>
			</div>
		</div>
	</nav>
</template>
