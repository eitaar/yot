import { ref } from "vue";
import type { Tag } from "@/api/client";
import { api } from "@/api/client";

const tags = ref<Tag[]>([]);

export function useTags() {
	async function load() {
		tags.value = await api.listTags();
	}
	return { tags, load };
}
