import { ref } from "vue";
import type { Tag, TagUpdate } from "@/api/client";
import { ApiError, api } from "@/api/client";
import { getAll, getDB, replaceAll } from "@/lib/db";
import { queueMutation } from "@/lib/syncQueue";

const tags = ref<Tag[]>([]);

function isNetworkError(e: unknown): boolean {
	return !(e instanceof ApiError);
}

export function useTags() {
	async function load() {
		tags.value = await getAll("tags");

		api
			.listTags()
			.then(async (result) => {
				tags.value = result;
				await replaceAll("tags", result);
			})
			.catch(() => {});
	}

	async function create(name: string, color?: string) {
		const input = { name, ...(color ? { color } : {}) };
		try {
			const tag = await api.createTag(input);
			await load();
			return tag;
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}
		const tempId = `temp-${crypto.randomUUID()}`;
		const tempTag: Tag = { id: tempId, name, color: color ?? null };
		tags.value = [...tags.value, tempTag];
		const db = await getDB();
		await db.put("tags", tempTag);
		await queueMutation({
			resource: "tag",
			action: "create",
			tempId,
			payload: input,
		});
		return tempTag;
	}

	async function update(id: string, input: TagUpdate) {
		try {
			await api.updateTag(id, input);
			await load();
			return;
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}
		const idx = tags.value.findIndex((t) => t.id === id);
		if (idx !== -1) {
			tags.value[idx] = { ...tags.value[idx], ...input };
			const db = await getDB();
			await db.put("tags", tags.value[idx]);
		}
		await queueMutation({
			resource: "tag",
			action: "update",
			id,
			payload: input,
		});
	}

	async function remove(id: string) {
		try {
			await api.deleteTag(id);
			await load();
			return;
		} catch (e) {
			if (!isNetworkError(e)) throw e;
		}
		tags.value = tags.value.filter((t) => t.id !== id);
		const db = await getDB();
		await db.delete("tags", id);
		await queueMutation({ resource: "tag", action: "delete", id });
	}

	return { tags, load, create, update, remove };
}
