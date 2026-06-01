import { ref } from "vue";

// Module-level singleton (matches useComposer/useSidebar): any component can
// open the import dialog; App.vue renders it.
const isOpen = ref(false);

export function useImport() {
	return {
		isOpen,
		open: () => {
			isOpen.value = true;
		},
		close: () => {
			isOpen.value = false;
		},
	};
}
