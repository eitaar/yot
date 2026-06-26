import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Calendar, Event, Tag } from "@/api/client";

export interface QueuedMutation {
	qid?: number;
	resource: "event" | "calendar" | "tag";
	action: "create" | "update" | "delete" | "addTag" | "removeTag";
	id?: string;
	tempId?: string;
	payload?: unknown;
	createdAt: number;
}

interface YotDB extends DBSchema {
	events: { key: string; value: Event };
	calendars: { key: string; value: Calendar };
	tags: { key: string; value: Tag };
	syncQueue: {
		key: number;
		value: QueuedMutation;
		indexes: { "by-created": number };
	};
	meta: { key: string; value: { key: string; value: unknown } };
}

type DataStore = "events" | "calendars" | "tags";

let dbPromise: Promise<IDBPDatabase<YotDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<YotDB>> {
	if (!dbPromise) {
		dbPromise = openDB<YotDB>("yot", 1, {
			upgrade(db) {
				db.createObjectStore("events", { keyPath: "id" });
				db.createObjectStore("calendars", { keyPath: "id" });
				db.createObjectStore("tags", { keyPath: "id" });
				const sq = db.createObjectStore("syncQueue", {
					keyPath: "qid",
					autoIncrement: true,
				});
				sq.createIndex("by-created", "createdAt");
				db.createObjectStore("meta", { keyPath: "key" });
			},
		});
	}
	return dbPromise;
}

export async function replaceAll<S extends DataStore>(
	store: S,
	items: YotDB[S]["value"][],
): Promise<void> {
	const db = await getDB();
	const tx = db.transaction(store, "readwrite");
	await tx.store.clear();
	for (const item of items) await tx.store.put(item);
	await tx.done;
}

export async function getAll<S extends DataStore>(
	store: S,
): Promise<YotDB[S]["value"][]> {
	const db = await getDB();
	return db.getAll(store);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
	const db = await getDB();
	const row = await db.get("meta", key);
	return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
	const db = await getDB();
	await db.put("meta", { key, value });
}

export async function enqueue(
	mutation: Omit<QueuedMutation, "qid">,
): Promise<number> {
	const db = await getDB();
	return db.add("syncQueue", mutation as QueuedMutation);
}

export async function peekQueue(): Promise<QueuedMutation[]> {
	const db = await getDB();
	return db.getAllFromIndex("syncQueue", "by-created");
}

export async function dequeue(qid: number): Promise<void> {
	const db = await getDB();
	await db.delete("syncQueue", qid);
}

export async function queueCount(): Promise<number> {
	const db = await getDB();
	return db.count("syncQueue");
}
