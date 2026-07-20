import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function cargoVersion(): string {
	const cargo = readFileSync(new URL("../Cargo.toml", import.meta.url), "utf-8");
	const m = cargo.match(/^version\s*=\s*"([^"]+)"/m);
	return m ? m[1] : "0.0.0";
}

export default defineConfig(({ mode }) => ({
	define: {
		__APP_VERSION__: JSON.stringify(cargoVersion()),
	},
	plugins: [
		vue(),
		tailwindcss(),
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: ["pwa-192x192.svg", "pwa-512x512.svg"],
			workbox: {
				// Keep the precache to the app shell. Fonts carry unicode-range, so the
				// browser only fetches the subset it actually needs — precaching every
				// woff/woff2 up front just bloats the service-worker install.
				globPatterns: ["**/*.{js,css,html,svg}"],
				// SPA offline support: serve the precached shell for any navigation the
				// precache can't resolve (e.g. reloading or deep-linking to /list, /cover,
				// /pair while offline). Without this, Workbox only matches "/" via its
				// directoryIndex default and every other route falls through to the network.
				navigateFallback: "/index.html",
				// API + SSE + image endpoints are backend routes, not SPA routes — never
				// answer them with the app shell. (These are same-origin under /api/ in prod.)
				navigateFallbackDenylist: [/^\/api\//, /^\/authorize/, /^\/oauth\//, /^\/.well-known\//],
				runtimeCaching: [
					{
						urlPattern: /\.woff2?$/,
						handler: "CacheFirst",
						options: {
							cacheName: "fonts",
							expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
							cacheableResponse: { statuses: [0, 200] },
						},
					},
					{
						urlPattern: /\/api\/img\//,
						handler: "CacheFirst",
						options: {
							cacheName: "cover-images",
							expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
							cacheableResponse: { statuses: [0, 200] },
						},
					},
				],
			},
			manifest: {
				name: "yot calendar",
				short_name: "yot",
				description: "A focused calendar front end for yot.",
				theme_color: "#047857",
				background_color: "#faf9f7",
				display: "standalone",
				scope: "/",
				start_url: "/",
				icons: [
					{
						src: "/pwa-192x192.svg",
						sizes: "192x192",
						type: "image/svg+xml",
						purpose: "any",
					},
					{
						src: "/pwa-512x512.svg",
						sizes: "512x512",
						type: "image/svg+xml",
						purpose: "any maskable",
					},
				],
			},
			devOptions: {
				enabled: mode === "development",
			},
		}),
	],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"@yot/schemas": fileURLToPath(new URL("../src/schemas", import.meta.url)),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:4010",
		},
	},
}));
