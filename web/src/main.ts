import { createApp } from "vue";
// Latin + latin-ext only. The full @fontsource/rubik/<weight>.css ships 6 subsets
// (latin, latin-ext, cyrillic, cyrillic-ext, hebrew, arabic) per weight — ~680KB of
// fonts the UI never uses. Restrict to the subsets we actually render.
import "@fontsource/rubik/latin-400.css";
import "@fontsource/rubik/latin-500.css";
import "@fontsource/rubik/latin-600.css";
import "@fontsource/rubik/latin-700.css";
import "@fontsource/rubik/latin-ext-400.css";
import "@fontsource/rubik/latin-ext-500.css";
import "@fontsource/rubik/latin-ext-600.css";
import "@fontsource/rubik/latin-ext-700.css";
import App from "./App.vue";
import { initTheme } from "./composables/useTheme";
import { router } from "./router";
import "./style.css";
import { registerSW } from "virtual:pwa-register";

initTheme();
registerSW({ immediate: true });
createApp(App).use(router).mount("#app");
