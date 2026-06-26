import { ref, readonly } from "vue";

const online = ref(navigator.onLine);
const reconnectCallbacks: Array<() => void> = [];

window.addEventListener("online", () => {
	online.value = true;
	for (const cb of reconnectCallbacks) cb();
});

window.addEventListener("offline", () => {
	online.value = false;
});

export function useOnline() {
	function onReconnect(cb: () => void) {
		reconnectCallbacks.push(cb);
	}
	return { online: readonly(online), onReconnect };
}
