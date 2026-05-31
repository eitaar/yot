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
	<div class="flex min-h-screen items-center justify-center bg-base-200 p-4">
		<form class="card w-80 bg-base-100 shadow-md" @submit.prevent="submit">
			<div class="card-body gap-4">
				<h1 class="text-center text-lg font-semibold">Pair this browser</h1>
				<p class="text-center text-sm text-base-content/60">
					Run <code class="rounded bg-base-200 px-1">npm run auth</code> and enter the PIN.
				</p>
				<input
					v-model="pin"
					inputmode="numeric"
					maxlength="6"
					placeholder="6-digit PIN"
					class="input w-full text-center text-2xl tracking-widest"
				/>
				<p v-if="error" class="text-sm text-error">{{ error }}</p>
				<button type="submit" :disabled="busy || pin.length < 6" class="btn btn-primary w-full">
					{{ busy ? "Pairing..." : "Pair" }}
				</button>
			</div>
		</form>
	</div>
</template>
