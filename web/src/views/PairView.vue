<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "@/composables/useAuth";

const pin = ref("");
const error = ref("");
const busy = ref(false);
const router = useRouter();
const { pair } = useAuth();

async function submit() {
	error.value = "";
	busy.value = true;
	try {
		await pair(pin.value.trim());
		router.push("/");
	} catch {
		error.value = "Invalid or expired PIN. Run `npm run auth` for a new one.";
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center bg-gray-50">
		<form
			class="w-80 space-y-4 rounded-lg border bg-white p-6 shadow-sm"
			@submit.prevent="submit"
		>
			<h1 class="text-center text-lg font-semibold">Pair this browser</h1>
			<p class="text-center text-sm text-gray-500">
				Run <code class="rounded bg-gray-100 px-1">npm run auth</code> and enter
				the PIN.
			</p>
			<input
				v-model="pin"
				inputmode="numeric"
				maxlength="6"
				placeholder="6-digit PIN"
				class="w-full rounded border px-3 py-2 text-center text-2xl tracking-widest"
			/>
			<p v-if="error" class="text-sm text-red-600">{{ error }}</p>
			<button
				type="submit"
				:disabled="busy || pin.length < 6"
				class="w-full rounded bg-blue-600 py-2 text-white disabled:opacity-50"
			>
				{{ busy ? "Pairing..." : "Pair" }}
			</button>
		</form>
	</div>
</template>
