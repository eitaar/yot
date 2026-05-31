import { ref } from "vue";

// Open/close state for the filter sidebar. On desktop the sidebar is a
// collapsible static panel (open by default); on mobile it is a slide-in
// overlay (closed by default). One shared singleton drives both.
const desktop =
	typeof window !== "undefined" &&
	window.matchMedia("(min-width: 1024px)").matches;
const isOpen = ref(desktop);

export function useSidebar() {
	function toggle() {
		isOpen.value = !isOpen.value;
	}
	function open() {
		isOpen.value = true;
	}
	function close() {
		isOpen.value = false;
	}
	return { isOpen, toggle, open, close };
}
