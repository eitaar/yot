import { createApp } from "vue";
import "@fontsource/rubik/400.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/600.css";
import "@fontsource/rubik/700.css";
import App from "./App.vue";
import { initTheme } from "./composables/useTheme";
import { router } from "./router";
import "./style.css";
import { registerSW } from "virtual:pwa-register";

initTheme();
registerSW({ immediate: true });
createApp(App).use(router).mount("#app");
