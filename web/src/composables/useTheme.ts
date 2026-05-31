import { ref } from "vue";

// Module-level singleton: the app has exactly one theme, driven by the OS.
const mql = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = ref(mql.matches);

function apply() {
	document.documentElement.classList.toggle("dark", isDark.value);
}

let initialized = false;

/** Apply the current OS theme and start tracking changes. Idempotent. */
export function initTheme() {
	if (initialized) return;
	initialized = true;
	apply();
	mql.addEventListener("change", (e) => {
		isDark.value = e.matches;
		apply();
	});
}

export function useTheme() {
	return { isDark };
}
