import { ref } from "vue";
import { ApiError, api } from "@/api/client";
import { getMeta, setMeta } from "@/lib/db";

const scope = ref<"read" | "write" | null>(null);
const checked = ref(false);

export function useAuth() {
	async function check(): Promise<boolean> {
		const cached = await getMeta<"read" | "write">("auth-scope");
		if (cached) {
			scope.value = cached;
			checked.value = true;
			// Validate with server in background — don't block the router guard
			api
				.session()
				.then(async (s) => {
					scope.value = s.scope;
					await setMeta("auth-scope", s.scope);
				})
				.catch(async (e) => {
					if (e instanceof ApiError && e.status === 401) {
						scope.value = null;
						await setMeta("auth-scope", null);
					}
				});
			return true;
		}

		// No cache — must wait for the API
		try {
			const s = await api.session();
			scope.value = s.scope;
			await setMeta("auth-scope", s.scope);
			return true;
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) {
				scope.value = null;
				await setMeta("auth-scope", null);
			}
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
		await setMeta("auth-scope", null);
	}

	function markUnauthenticated(): void {
		scope.value = null;
		checked.value = true;
	}

	return { scope, checked, check, pair, logout, markUnauthenticated };
}
