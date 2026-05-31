import { onUnmounted, ref } from "vue";

/**
 * Reactive media-query match. Returns a ref that tracks `matchMedia(query)`
 * and cleans up its listener on unmount.
 */
export function useMediaQuery(query: string) {
	const mql = window.matchMedia(query);
	const matches = ref(mql.matches);
	const onChange = (e: MediaQueryListEvent) => {
		matches.value = e.matches;
	};
	mql.addEventListener("change", onChange);
	onUnmounted(() => mql.removeEventListener("change", onChange));
	return matches;
}

/** True at the `lg` breakpoint (1024px) and up — the desktop/mobile boundary. */
export function useIsDesktop() {
	return useMediaQuery("(min-width: 1024px)");
}
