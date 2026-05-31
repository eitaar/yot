import { ref } from "vue";
import type { Tag, TagUpdate } from "@/api/client";
import { api } from "@/api/client";

const tags = ref<Tag[]>([]);

export function useTags() {
	async function load() {
		tags.value = await api.listTags();
	}
	async function create(name: string, color?: string) {
		const tag = await api.createTag({ name, ...(color ? { color } : {}) });
		await load();
		return tag;
	}
	async function update(id: string, input: TagUpdate) {
		await api.updateTag(id, input);
		await load();
	}
	async function remove(id: string) {
		await api.deleteTag(id);
		await load();
	}
	return { tags, load, create, update, remove };
}
