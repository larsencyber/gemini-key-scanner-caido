import { Classic } from "@caido/primevue";
import PrimeVue from "primevue/config";
import { createApp } from "vue";

import { SDKPlugin } from "./plugins/sdk";
import "./styles/index.css";
import type { FrontendSDK, KeyFinding } from "./types";
import App from "./views/App.vue";

const PLUGIN_ID = "gemini-key-scanner";

export const init = (sdk: FrontendSDK) => {
  const app = createApp(App);

  app.use(PrimeVue, { unstyled: true, pt: Classic });
  app.use(SDKPlugin, sdk);

  const root = document.createElement("div");
  Object.assign(root.style, { height: "100%", width: "100%" });
  root.id = `plugin--${PLUGIN_ID}`;

  app.mount(root);

  sdk.navigation.addPage(`/${PLUGIN_ID}`, { body: root });
  sdk.sidebar.registerItem("Gemini Key Scanner", `/${PLUGIN_ID}`, {
    icon: "fas fa-key",
  });

  sdk.backend.onEvent("onNewFinding", (finding: KeyFinding) => {
    if (finding.status === "pending") return;
    const label: Record<string, string> = {
      confirmed: "Active Gemini access",
      accessible: "Gemini API accessible (no models)",
      no_access: "No Gemini access",
      network_error: "Verification failed",
    };
    const msg = `Key found on ${finding.host}: ${finding.key.slice(0, 12)}… — ${label[finding.status] ?? finding.status}`;
    sdk.window.showToast(msg, { variant: "success", duration: 6000 });
  });
};
