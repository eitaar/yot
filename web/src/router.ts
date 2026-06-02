import { createRouter, createWebHistory } from "vue-router";
import { setUnauthorizedHandler } from "@/api/client";
import { useAuth } from "@/composables/useAuth";

const auth = useAuth();

// A 401 from any request invalidates our cached session; the next navigation
// guard then routes to /pair. We deliberately don't navigate from here to avoid
// fighting an in-flight route transition.
setUnauthorizedHandler(() => auth.markUnauthenticated());

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
			path: "/cover",
			name: "cover",
			component: () => import("@/views/ListView.vue"),
		},
		{
			path: "/pair",
			name: "pair",
			component: () => import("@/views/PairView.vue"),
		},
	],
});

// Validate the session once, then trust the cached result. The previous guard
// awaited a /auth/session round-trip on EVERY navigation, which over a tunnel
// added latency to each view switch. A later 401 clears the cache (see above).
router.beforeEach(async (to) => {
	if (to.name === "pair") return true;
	if (!auth.checked.value) await auth.check();
	return auth.scope.value ? true : { name: "pair" };
});
