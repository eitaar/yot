import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
	plugins: [
		vue(),
		tailwindcss(),
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: ["pwa-192x192.svg", "pwa-512x512.svg"],
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
