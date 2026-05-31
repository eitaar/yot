<script setup lang="ts">
import { Download } from "@lucide/vue";
import { onMounted, onUnmounted, ref } from "vue";

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
const canInstall = ref(false);

function onBeforeInstallPrompt(event: Event) {
	event.preventDefault();
	deferredPrompt.value = event as BeforeInstallPromptEvent;
	canInstall.value = true;
}

function onAppInstalled() {
	deferredPrompt.value = null;
	canInstall.value = false;
}

async function install() {
	const prompt = deferredPrompt.value;
	if (!prompt) return;
	await prompt.prompt();
	await prompt.userChoice;
	onAppInstalled();
}

onMounted(() => {
	window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
	window.addEventListener("appinstalled", onAppInstalled);
});

onUnmounted(() => {
	window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
	window.removeEventListener("appinstalled", onAppInstalled);
});
</script>

<template>
	<button
		v-if="canInstall"
		type="button"
		class="btn btn-accent btn-sm gap-1 px-2"
		@click="install"
	>
		<Download :size="16" aria-hidden="true" />
		<span class="hidden sm:inline">Install</span>
	</button>
</template>
