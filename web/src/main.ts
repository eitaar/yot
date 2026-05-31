import { createApp } from "vue";
import App from "./App.vue";
import { initTheme } from "./composables/useTheme";
import { router } from "./router";
import "./style.css";

initTheme();
createApp(App).use(router).mount("#app");
