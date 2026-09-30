import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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
    IFC_MODEL_CACHE_DIR: path.join(userDataDir, "model-cache"),
    LOCALAPPDATA: userDataDir,
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

let browser;
try {
  await waitForCdp();
  browser = await chromium.connectOverCDP(cdpUrl);
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (!page) throw new Error("WebView2 did not expose an application page");
  const diagnostics = [];
  page.on("console", (message) => diagnostics.push(`console.${message.type()}: ${message.text().replace(/pk\.[A-Za-z0-9._-]+/g, '[public-token]').replace(/access_token=[^&\s]+/g, 'access_token=[redacted]')}`));
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
    await page.locator('input[type="file"]').setInputFiles(process.env.IFC_E2E_MODEL_PATH);
    await page.waitForFunction(() => window.__packageMetrics.length === 1, null, { timeout: 120000 });
    await page.waitForFunction(async () => {
      const { token } = await window.pywebview.api.get_api_session();
      const state = await (await fetch('/model/runtime', { headers: { 'X-IFC-Session': token } })).json();
      return state.hotIndexStatus === 'ready' && state.coldIndexStatus === 'ready';
    }, null, { timeout: 120000 });
    let georeference;
    const georeferenceDeadline = Date.now() + 120000;
    do {
      georeference = await page.evaluate(async () => {
        const { token } = await window.pywebview.api.get_api_session();
        const modelHash = window.__packageMetrics[0].modelHash;
        const response = await fetch(`/model/georeference?modelHash=${modelHash}`, {
          headers: { 'X-IFC-Session': token },
        });
        return { ok: response.ok, modelHash, body: await response.json() };
      });
      if (georeference.ok || georeference.body.error !== 'index_preparing') break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < georeferenceDeadline);
    if (!georeference.ok || georeference.body.modelHash !== georeference.modelHash
      || !['projected', 'unavailable'].includes(georeference.body.status)) {
      throw new Error(`Packaged GIS metadata query failed: ${JSON.stringify(georeference)}`);
    }
    let publicToken = process.env.MAPBOX_TEST_TOKEN;
    if (!publicToken) {
      const local = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
      publicToken = local.match(/^VITE_MAPBOX_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
    }
    if (!publicToken?.startsWith('pk.')) throw new Error('Missing public Mapbox test token');
    await page.getByRole('button', { name: 'BIM–GIS Mapbox', exact: true }).click();
    await page.getByRole('button', { name: 'Mở Cài đặt Mapbox' }).click();
    await page.getByLabel('Public access token (pk.)').fill(publicToken);
    await page.getByRole('button', { name: 'Kiểm tra key', exact: true }).click();
    await page.getByText('Key hợp lệ · Light v10 tải được', { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Lưu key', exact: true }).click();
    await page.waitForFunction(async () => Boolean((await window.pywebview.api.load_settings())?.mapboxPublicToken));
    await page.locator('.viewer-settings__header button').click();
    const frame = page.frameLocator('iframe[title="Mapbox BIM–GIS"]');
    await frame.locator('html[data-model-state="ready"]').waitFor({ timeout: 120000 });
    if (process.env.IFC_E2E_GIS_SCREENSHOT) {
      await page.waitForTimeout(2500);
      await page.screenshot({ path: process.env.IFC_E2E_GIS_SCREENSHOT.replace(/\.png$/, '-globe.png') });
    }
    await page.getByRole('button', { name: 'Bay tới mô hình', exact: true }).click();
    await frame.locator('html[data-model-layer="ready"]').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const html = document.querySelector('iframe[title="Mapbox BIM–GIS"]').contentDocument.documentElement;
      return Number(html.dataset.renderedTriangles) > 0;
    });
    await page.waitForTimeout(2500);
    if (process.env.IFC_E2E_GIS_SCREENSHOT) await page.screenshot({ path: process.env.IFC_E2E_GIS_SCREENSHOT });
    await page.getByRole('button', { name: 'Đặt / xoay IFC', exact: true }).click();
    await page.getByLabel('Xoay IFC (°)', { exact: true }).fill('35');
    await frame.locator('html[data-model-yaw="35"]').waitFor();
    await page.getByRole('button', { name: 'Lưu vị trí', exact: true }).click();
    await page.getByText('Đã lưu vị trí thủ công', { exact: true }).waitFor();
    const placement = await page.evaluate(async () => {
      const {token} = await window.pywebview.api.get_api_session();
      const modelHash = window.__packageMetrics[0].modelHash;
      return (await fetch(`/model/gis-anchor?modelHash=${modelHash}`, {headers:{'X-IFC-Session':token}})).json();
    });
    if (placement.anchor?.rotationDegrees !== 35) throw new Error('Packaged placement was not persisted');
    await page.getByRole('button', { name: 'Ẩn marker', exact: true }).click();
    await frame.locator('.mapboxgl-marker').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Hiện marker', exact: true }).click();
    await frame.locator('.mapboxgl-marker').waitFor();
    for (let n = 0; n < 4; n++) await frame.locator('.mapboxgl-ctrl-zoom-out').click();
    await page.waitForTimeout(2500);
    if (process.env.IFC_E2E_GIS_SCREENSHOT) await page.screenshot({ path: process.env.IFC_E2E_GIS_SCREENSHOT.replace(/\.png$/, '-city.png') });
    const rectangle = await frame.locator('.mapboxgl-canvas').boundingBox();
    await page.mouse.move(rectangle.x + rectangle.width * .6, rectangle.y + rectangle.height * .55);
    await page.mouse.down({button:'right'});
    await page.mouse.move(rectangle.x + rectangle.width * .6 + 160, rectangle.y + rectangle.height * .55 - 50,{steps:10});
    await page.mouse.up({button:'right'});
    await page.waitForTimeout(1500);
    await frame.locator('html[data-model-yaw="35"]').waitFor();
    if (process.env.IFC_E2E_GIS_SCREENSHOT) await page.screenshot({ path: process.env.IFC_E2E_GIS_SCREENSHOT.replace(/\.png$/, '-orbit.png') });
    await page.getByRole('button', { name: 'Về IFC viewer', exact: true }).click();
    await page.locator('.viewer-mount canvas').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Cài đặt hiển thị', exact: true }).click();
    await page.getByRole('button', { name: 'Xóa key', exact: true }).click();
    await page.waitForFunction(async () => (await window.pywebview.api.load_settings())?.mapboxPublicToken === '');
    await page.getByLabel('Public access token (pk.)').fill(publicToken);
    await page.getByRole('button', { name: 'Lưu key', exact: true }).click();
    await page.waitForFunction(async () => Boolean((await window.pywebview.api.load_settings())?.mapboxPublicToken));
    await page.locator('.viewer-settings__header button').click();
    await page.getByRole('button', { name: 'BIM–GIS Mapbox', exact: true }).click();
    await frame.locator('html[data-model-state="ready"]').waitFor();
    process.stdout.write("packaged Mapbox live tiles, IFC.js GLB/JSON, actual draw, yaw, placement, key persistence and viewer switch passed\n");
    process.stdout.write("packaged IFC geometry, semantic index and GIS 3D layer passed\n");
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
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
}
