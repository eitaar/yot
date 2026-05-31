import { createApp } from "vue";
import App from "./App.vue";
import { initTheme } from "./composables/useTheme";
import { router } from "./router";
import "./style.css";
import { registerSW } from "virtual:pwa-register";

initTheme();
registerSW({ immediate: true });
createApp(App).use(router).mount("#app");
