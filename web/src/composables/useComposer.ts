import { ref } from "vue";

export type ComposerPrefill = {
	start?: string;
	end?: string;
	all_day?: boolean;
};

// Shared "open the create-event modal" signal. The bottom dock's + New button
// (and anything else outside a view) bumps `tick`; the currently mounted view
// watches it and opens its own EventModal, optionally with a prefill.
const tick = ref(0);
const prefill = ref<ComposerPrefill | null>(null);

export function useComposer() {
	function requestCreate(input: ComposerPrefill | null = null) {
		prefill.value = input;
		tick.value++;
	}
	return { tick, prefill, requestCreate };
}
