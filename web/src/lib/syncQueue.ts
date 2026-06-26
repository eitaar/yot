import { ref } from "vue";
import { api } from "@/api/client";
import {
	enqueue,
	peekQueue,
	dequeue,
	queueCount,
	type QueuedMutation,
} from "./db";

export const pendingCount = ref(0);
export const syncing = ref(false);

export async function refreshPendingCount(): Promise<void> {
	pendingCount.value = await queueCount();
}

export async function queueMutation(
	mutation: Omit<QueuedMutation, "qid" | "createdAt">,
): Promise<void> {
	await enqueue({ ...mutation, createdAt: Date.now() });
	await refreshPendingCount();
}

export async function flushQueue(): Promise<boolean> {
	if (syncing.value) return false;
	syncing.value = true;
	const tempToReal = new Map<string, string>();
	try {
		const items = await peekQueue();
		for (const item of items) {
			try {
				await replayMutation(item, tempToReal);
				await dequeue(item.qid!);
			} catch (e) {
				if (isConflictOrGone(e)) {
					await dequeue(item.qid!);
					continue;
				}
				console.error("[sync] failed to replay mutation", item, e);
				return false;
			}
		}
		return true;
	} finally {
		syncing.value = false;
		await refreshPendingCount();
	}
}

function isConflictOrGone(e: unknown): boolean {
	if (e && typeof e === "object" && "status" in e) {
		const s = (e as { status: number }).status;
		return s === 404 || s === 409 || s === 410;
	}
	return false;
}

async function replayMutation(
	m: QueuedMutation,
	tempToReal: Map<string, string>,
): Promise<void> {
	const resolveId = (id?: string) =>
		id ? (tempToReal.get(id) ?? id) : id!;

	switch (m.resource) {
		case "event":
			switch (m.action) {
				case "create": {
					const created = await api.createEvent(
						m.payload as Parameters<typeof api.createEvent>[0],
					);
					if (m.tempId) tempToReal.set(m.tempId, created.id);
					break;
				}
				case "update":
					await api.updateEvent(
						resolveId(m.id),
						m.payload as Parameters<typeof api.updateEvent>[1],
					);
					break;
				case "delete":
					await api.deleteEvent(resolveId(m.id));
					break;
				case "addTag":
					await api.addEventTag(resolveId(m.id), m.payload as string);
					break;
				case "removeTag":
					await api.removeEventTag(
						resolveId(m.id),
						m.payload as string,
					);
					break;
			}
			break;
		case "calendar":
			switch (m.action) {
				case "create": {
					const created = await api.createCalendar(
						m.payload as Parameters<typeof api.createCalendar>[0],
					);
					if (m.tempId) tempToReal.set(m.tempId, created.id);
					break;
				}
				case "update":
					await api.updateCalendar(
						resolveId(m.id),
						m.payload as Parameters<typeof api.updateCalendar>[1],
					);
					break;
			}
			break;
		case "tag":
			switch (m.action) {
				case "create": {
					const created = await api.createTag(
						m.payload as Parameters<typeof api.createTag>[0],
					);
					if (m.tempId) tempToReal.set(m.tempId, created.id);
					break;
				}
				case "update":
					await api.updateTag(
						resolveId(m.id),
						m.payload as Parameters<typeof api.updateTag>[1],
					);
					break;
				case "delete":
					await api.deleteTag(resolveId(m.id));
					break;
			}
			break;
	}
}
