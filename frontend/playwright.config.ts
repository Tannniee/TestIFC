import { defineConfig } from "@playwright/test";

const baseURL = process.env.IFC_E2E_BASE_URL || "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "off",
    launchOptions: {
      args: ["--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${new URL(baseURL).port || "4173"} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
