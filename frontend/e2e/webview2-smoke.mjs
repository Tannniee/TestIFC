import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const executable = process.env.IFC_VIEWER_EXE;
if (!executable) throw new Error("IFC_VIEWER_EXE must point to the packaged application");

async function reserveFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Could not reserve a WebView2 CDP port");
  return port;
}

const requestedCdpUrl = process.env.IFC_WEBVIEW2_CDP_URL;
const cdpPort = requestedCdpUrl ? Number(new URL(requestedCdpUrl).port) : await reserveFreePort();
if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65_535) {
  throw new Error(`Invalid WebView2 CDP port: ${requestedCdpUrl}`);
}
const cdpUrl = requestedCdpUrl ?? `http://127.0.0.1:${cdpPort}`;
const userDataDir = await mkdtemp(path.join(tmpdir(), "ifc-viewer-webview2-"));
const child = spawn(executable, [], {
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: userDataDir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      `--remote-debugging-port=${cdpPort} --headless=new --disable-gpu --no-first-run`,
  },
  stdio: "inherit",
});

async function waitForCdp(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${cdpUrl}/json/version`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`WebView2 CDP did not become ready: ${lastError ?? "timeout"}`);
}

let browser;
try {
  await waitForCdp();
  browser = await chromium.connectOverCDP(cdpUrl);
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (!page) throw new Error("WebView2 did not expose an application page");
  await page.waitForSelector(".viewer-mount canvas", { timeout: 30_000 });
  const canvasCount = await page.locator(".viewer-mount canvas").count();
  if (canvasCount !== 1) throw new Error(`Expected one viewer canvas, found ${canvasCount}`);
  const health = await page.evaluate(async () => (await fetch("/health")).json());
  if (health?.ok !== true) throw new Error("Packaged WebView2 could not reach the local bridge");
  process.stdout.write("packaged WebView2 CDP smoke test passed\n");
} finally {
  await browser?.close().catch(() => undefined);
  if (child.exitCode === null) child.kill();
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
}
