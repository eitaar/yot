import { ref } from "vue";
import { ApiError, api } from "@/api/client";

const scope = ref<"read" | "write" | null>(null);
const checked = ref(false);

export function useAuth() {
	async function check(): Promise<boolean> {
		try {
			const s = await api.session();
			scope.value = s.scope;
			return true;
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) scope.value = null;
			return false;
		} finally {
			checked.value = true;
		}
	}

	async function pair(pin: string): Promise<void> {
		await api.pair(pin);
		await check();
	}

	async function logout(): Promise<void> {
		await api.logout();
		scope.value = null;
	}

	// Drop the cached session (e.g. after a 401) so the next navigation guard
	// treats us as unauthenticated and routes to /pair.
	function markUnauthenticated(): void {
		scope.value = null;
		checked.value = true;
	}

	return { scope, checked, check, pair, logout, markUnauthenticated };
}
