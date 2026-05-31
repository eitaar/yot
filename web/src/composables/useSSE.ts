import { onUnmounted, ref } from "vue";

const CHANGE_EVENTS = [
	"calendar.created",
	"calendar.updated",
	"calendar.deleted",
	"event.created",
	"event.updated",
	"event.deleted",
	"tag.created",
	"tag.updated",
	"tag.deleted",
] as const;

export function useSSE(onChange: () => void) {
	const connected = ref(false);
	let es: EventSource | null = null;
	let retry: ReturnType<typeof setTimeout> | null = null;

	function connect() {
		es = new EventSource("/api/stream", { withCredentials: true });
		es.addEventListener("ready", () => {
			connected.value = true;
		});
		es.onerror = () => {
			connected.value = false;
			es?.close();
			retry = setTimeout(connect, 2000);
		};
		for (const type of CHANGE_EVENTS) {
			es.addEventListener(type, () => onChange());
		}
	}

	function close() {
		if (retry) clearTimeout(retry);
		es?.close();
		connected.value = false;
	}

	connect();
	onUnmounted(close);
	return { connected };
}
