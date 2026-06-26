import { useOnline } from "./useOnline";
import {
	flushQueue,
	refreshPendingCount,
	syncing,
	pendingCount,
} from "@/lib/syncQueue";

export function useSync(refreshAll: () => Promise<void>) {
	const { onReconnect } = useOnline();

	onReconnect(async () => {
		await flushQueue();
		await refreshAll();
	});

	refreshPendingCount();

	return { syncing, pendingCount };
}
