import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { API_PROXY_PREFIXES } from "./src/lib/api-contracts.ts";

export default defineConfig(({ mode }) => {
  const bridge = loadEnv(mode, ".", "IFC_BRIDGE_URL").IFC_BRIDGE_URL || "http://127.0.0.1:8000";
  const token = loadEnv(mode, ".", "IFC_API_SESSION_TOKEN").IFC_API_SESSION_TOKEN;
  return {
    plugins: [svelte()],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // web-ifc and the fragments worker are intentionally shipped as local bundles.
      chunkSizeWarningLimit: 5000,
    },
    server: {
      proxy: Object.fromEntries(API_PROXY_PREFIXES.map((prefix) => [prefix, {
        target: bridge,
        headers: token ? { "X-IFC-Session": token } : {},
        bypass(request, response) {
          const origin = request.headers.origin;
          if (origin !== undefined && origin !== `http://${request.headers.host}`) {
            response.writeHead(403, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: "untrusted_origin" }));
            return false;
          }
        },
      }])),
    },
  };
});
