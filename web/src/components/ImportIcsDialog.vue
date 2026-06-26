<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ImportSummary } from "@/api/client";
import { api } from "@/api/client";
import { useCalendars } from "@/composables/useCalendars";
import { useOnline } from "@/composables/useOnline";

const { online } = useOnline();

const emit = defineEmits<{ close: [] }>();
const { calendars, load } = useCalendars();

const calendarId = ref("");
const file = ref<File | null>(null);
const busy = ref(false);
const error = ref("");
const result = ref<ImportSummary | null>(null);

onMounted(async () => {
	if (!calendars.value.length) await load();
	calendarId.value = calendars.value[0]?.id ?? "";
});

function onPick(e: globalThis.Event) {
	file.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function submit() {
	error.value = "";
	if (!file.value || !calendarId.value) {
		error.value = "Choose a calendar and an .ics file.";
		return;
	}
	busy.value = true;
	try {
		result.value = await api.importIcs(file.value, calendarId.value);
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<div class="modal modal-open modal-bottom sm:modal-middle" @click.self="emit('close')">
		<div class="modal-box w-full max-w-md">
			<h2 class="mb-4 text-xl font-semibold">Import .ics</h2>

			<div v-if="result" class="space-y-3">
				<p class="text-sm">
					Imported <strong>{{ result.created }}</strong> event(s).
				</p>
				<ul class="text-sm text-base-content/70">
					<li v-if="result.skippedRecurring">Skipped {{ result.skippedRecurring }} recurring</li>
					<li v-if="result.skippedDuplicate">Skipped {{ result.skippedDuplicate }} duplicate</li>
					<li v-if="result.errors.length">{{ result.errors.length }} error(s)</li>
				</ul>
				<div class="modal-action">
					<button class="btn btn-primary btn-sm" @click="emit('close')">Done</button>
				</div>
			</div>

			<form v-else class="flex flex-col gap-3" @submit.prevent="submit">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Target calendar</legend>
					<select v-model="calendarId" required class="select w-full">
						<option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.name }}</option>
					</select>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">.ics file</legend>
					<input type="file" accept=".ics,text/calendar" class="file-input w-full" @change="onPick" />
				</fieldset>
				<p v-if="error" class="text-sm text-error">{{ error }}</p>
				<div class="modal-action">
					<button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">Cancel</button>
					<button :disabled="busy || !online" class="btn btn-primary btn-sm">
						{{ !online ? "Offline" : busy ? "Importing…" : "Import" }}
					</button>
				</div>
			</form>
		</div>
	</div>
</template>
