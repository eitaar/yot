import { createRouter, createWebHistory } from "vue-router";
import { ApiError, api } from "@/api/client";

export const router = createRouter({
	history: createWebHistory(),
	routes: [
		{
			path: "/",
			name: "calendar",
			component: () => import("@/views/CalendarView.vue"),
		},
		{
			path: "/list",
			name: "list",
			component: () => import("@/views/ListView.vue"),
		},
		{
			path: "/pair",
			name: "pair",
			component: () => import("@/views/PairView.vue"),
		},
	],
});

router.beforeEach(async (to) => {
	if (to.name === "pair") return true;
	try {
		await api.session();
		return true;
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) return { name: "pair" };
		return true;
	}
});
