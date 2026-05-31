import { ref } from "vue";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const mql = window.matchMedia("(prefers-color-scheme: dark)");

function readStored(): ThemeMode {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v === "light" || v === "dark" || v === "system") return v;
	} catch {}
	return "system";
}

// Module-level singleton: the app has exactly one theme mode.
const mode = ref<ThemeMode>(readStored());

function resolved(): "light" | "dark" {
	if (mode.value === "system") return mql.matches ? "dark" : "light";
	return mode.value;
}

// The concrete light/dark theme currently applied. Consumers (e.g. the
// schedule-x calendar) watch this to stay in sync with the DaisyUI theme.
const resolvedTheme = ref<"light" | "dark">(resolved());

function apply() {
	const next = resolved();
	resolvedTheme.value = next;
	document.documentElement.dataset.theme = next;
}

function setMode(next: ThemeMode) {
	mode.value = next;
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {}
	apply();
}

let initialized = false;

/** Apply the persisted theme and track OS changes while in system mode. */
export function initTheme() {
	if (initialized) return;
	initialized = true;
	apply();
	mql.addEventListener("change", () => {
		if (mode.value === "system") apply();
	});
}

export function useTheme() {
	return { mode, resolvedTheme, setMode };
}
