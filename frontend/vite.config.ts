import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig(({ mode }) => {
  const bridge = loadEnv(mode, ".", "IFC_BRIDGE_URL").IFC_BRIDGE_URL || "http://127.0.0.1:8000";
  return {
    plugins: [svelte()],
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      proxy: {
        "/auth": bridge,
        "/health": bridge,
        "/load-model": bridge,
        "/mass": bridge,
        "/model": bridge,
        "/selection": bridge,
      },
    },
  };
});
