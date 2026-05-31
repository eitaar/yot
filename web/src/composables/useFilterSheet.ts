import { ref } from "vue";

// Open/close state for the mobile filter bottom sheet. Singleton so the
// Filter button in any view drives the same sheet (mirrors useSidebar).
const isOpen = ref(false);

export function useFilterSheet() {
	function open() {
		isOpen.value = true;
	}
	function close() {
		isOpen.value = false;
	}
	function toggle() {
		isOpen.value = !isOpen.value;
	}
	return { isOpen, open, close, toggle };
}
