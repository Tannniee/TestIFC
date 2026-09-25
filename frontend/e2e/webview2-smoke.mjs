import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const executable = process.env.IFC_VIEWER_EXE;
if (!executable) throw new Error("IFC_VIEWER_EXE must point to the packaged application");
const semanticTimeoutMs = Number(process.env.IFC_E2E_SEMANTIC_TIMEOUT_MS || 120000);
const geometryTimeoutMs = Number(process.env.IFC_E2E_GEOMETRY_TIMEOUT_MS || 120000);

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
    IFC_MODEL_CACHE_DIR: path.join(userDataDir, "model-cache"),
    WEBVIEW2_USER_DATA_FOLDER: userDataDir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      `--remote-debugging-port=${cdpPort} --enable-unsafe-swiftshader --no-first-run`,
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

async function setLocalInputFile(page, filePath) {
  // Playwright's remote-CDP adapter serializes files and rejects payloads over
  // 50 MB. WebView2 and the test runner share this Windows host, so let CDP
  // assign the local path without copying the IFC through the protocol.
  const session = await page.context().newCDPSession(page);
  const { root } = await session.send("DOM.getDocument", { depth: 1 });
  const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
  if (!nodeId) throw new Error("Packaged viewer file input was not found");
  await session.send("DOM.setFileInputFiles", { nodeId, files: [path.resolve(filePath)] });
  await session.detach();
  // CDP assigns a local path without a Playwright upload. Explicitly notify
  // Svelte's file input handler after the assignment.
  await page.evaluate(() => document.querySelector('input[type="file"]')
    ?.dispatchEvent(new Event("change", { bubbles: true })));
}

let browser;
try {
  await waitForCdp();
  browser = await chromium.connectOverCDP(cdpUrl);
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (!page) throw new Error("WebView2 did not expose an application page");
  await page.waitForURL((url) => url.protocol === "http:" || url.protocol === "https:", { timeout: 60_000 });
  const diagnostics = [];
  page.on("console", (message) => diagnostics.push(`console.${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  try {
    await page.waitForSelector(".viewer-mount canvas", { timeout: 30_000 });
  } catch (error) {
    process.stderr.write(`WebView2 page: ${page.url()}\n${diagnostics.join("\n")}\n`);
    throw error;
  }
  const canvasCount = await page.locator(".viewer-mount canvas").count();
  if (canvasCount !== 1) throw new Error(`Expected one viewer canvas, found ${canvasCount}`);
  const health = await page.evaluate(async () => (await fetch("/health")).json());
  if (health?.ok !== true) throw new Error("Packaged WebView2 could not reach the local bridge");
  if (process.env.IFC_E2E_MODEL_PATH) {
    await page.evaluate(() => {
      window.__packageMetrics = [];
      window.addEventListener("ifc-fragment-metrics", e => window.__packageMetrics.push(e.detail));
    });
    await setLocalInputFile(page, process.env.IFC_E2E_MODEL_PATH);
    await page.waitForFunction(() => window.__packageMetrics.length === 1, null, { timeout: geometryTimeoutMs });
    if (process.env.IFC_E2E_PRINT_METRICS === "1") {
      const metrics = await page.evaluate(() => window.__packageMetrics[0]);
      process.stdout.write(`packaged load metrics: ${JSON.stringify(metrics)}\n`);
    }
    await page.waitForFunction(async () => {
      const { token } = await window.pywebview.api.get_api_session();
      const state = await (await fetch('/model/runtime', { headers: { 'X-IFC-Session': token } })).json();
      if (state.semanticMode === 'native') {
        return state.hotIndexStatus === 'ready' && state.coldIndexStatus === 'not_configured';
      }
      return state.hotIndexStatus === 'ready' && state.coldIndexStatus === 'ready';
    }, null, { timeout: semanticTimeoutMs });
    const runtime = await page.evaluate(async () => {
      const { token } = await window.pywebview.api.get_api_session();
      return (await fetch('/model/runtime', { headers: { 'X-IFC-Session': token } })).json();
    });
    if (process.env.IFC_E2E_SCREENSHOT) {
      await page.screenshot({ path: process.env.IFC_E2E_SCREENSHOT });
    }
    process.stdout.write(`packaged real IFC geometry and ${runtime.semanticMode} semantics passed\n`);
  }
  process.stdout.write("packaged WebView2 CDP smoke test passed\n");
} finally {
  // PyInstaller one-file launches a child GUI process. Close only this process tree.
  if (child.exitCode === null && child.pid) {
    const script = `$owned = @(${child.pid}); $all = Get-CimInstance Win32_Process; do { $next = @($all | Where-Object { $_.ParentProcessId -in $owned -and $_.ProcessId -notin $owned } | ForEach-Object { $_.ProcessId }); $owned += $next } while ($next.Count); foreach ($id in $owned) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { $null = $p.CloseMainWindow() } }`;
    spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15000 });
    for (let i = 0; i < 50 && child.exitCode === null; i++) await new Promise(resolve => setTimeout(resolve, 200));
    if (child.exitCode === null) {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      process.exitCode = 1;
      process.stderr.write("Packaged application did not close gracefully\n");
    } else {
      process.stdout.write(`packaged graceful exit: ${child.exitCode}\n`);
      if (child.exitCode !== 0) process.exitCode = 1;
    }
  }
  await browser?.close().catch(() => undefined);
  if (path.dirname(path.resolve(userDataDir)) !== path.resolve(tmpdir()) ||
      !path.basename(userDataDir).startsWith("ifc-viewer-webview2-")) {
    throw new Error(`Refusing to remove an unexpected WebView2 test directory: ${userDataDir}`);
  }
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
}
