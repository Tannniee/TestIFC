import { mount, unmount } from "svelte";
import App from "./App.svelte";
import { viewerLifecycleSnapshot } from "./lib/lifecycle-diagnostics";
import "./styles.css";

const target = document.getElementById("app")!;
let component = mount(App, { target });

if (import.meta.env.DEV) {
  window.__ifcViewerLifecycle = {
    async remount() {
      await unmount(component);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      component = mount(App, { target });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    snapshot() {
      return {
        ...viewerLifecycleSnapshot(),
        canvasCount: target.querySelectorAll("canvas").length,
      };
    },
  };
}
