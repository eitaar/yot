import { onUnmounted, ref } from "vue";

/** Which resource a broadcast change touched — lets callers reload only that slice. */
export type ChangeResource = "calendar" | "event" | "tag";

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

export function useSSE(onChange: (resource: ChangeResource) => void) {
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
			const resource = type.split(".")[0] as ChangeResource;
			es.addEventListener(type, () => onChange(resource));
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
