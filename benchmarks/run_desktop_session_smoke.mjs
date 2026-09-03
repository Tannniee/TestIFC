import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.env.IFC_DESKTOP_SMOKE_OUTPUT || `benchmarks/results/desktop-session-${Date.now()}`);
await mkdir(out, { recursive: true });
const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const cdpPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
const stopFile = path.join(out, "desktop.stop");
const env = { ...process.env, IFC_MODEL_CACHE_DIR: path.join(out, "cache"), WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --no-first-run` };
delete env.IFC_VIEWER_PORT; delete env.IFC_API_SESSION_TOKEN;
const child = spawn(path.join(root, ".venv/Scripts/python.exe"), ["benchmarks/serve_desktop_smoke.py", stopFile, path.join(out, "data")], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
const log = createWriteStream(path.join(out, "process.log")); child.stdout.pipe(log); child.stderr.pipe(log);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
const results = { sourceDesktop: true };
try {
  const cdp = `http://127.0.0.1:${cdpPort}`;
  let ready = false;
  for (let i = 0; i < 160; i++) { if (child.exitCode !== null) throw new Error(`Desktop exited ${child.exitCode}`); try { if ((await fetch(`${cdp}/json/version`)).ok) { ready = true; break; } } catch {} await pause(250); }
  if (!ready) throw new Error("Desktop CDP did not start");
  browser = await chromium.connectOverCDP(cdp);
  const page = browser.contexts()[0].pages()[0];
  const errors = []; page.on("pageerror", error => errors.push(String(error)));
  await page.waitForSelector(".viewer-mount canvas", { timeout: 30000 });
  await page.waitForFunction(() => typeof window.pywebview?.api?.get_api_session === "function");
  results.session = await page.evaluate(async () => {
    const session = await window.pywebview.api.get_api_session();
    const anonymous = await fetch("/selection");
    const authenticated = await fetch("/selection", { headers: { "X-IFC-Session": session.token } });
    return { anonymous: anonymous.status, authenticated: authenticated.status, tokenLength: session.token.length };
  });
  if (results.session.anonymous !== 401 || results.session.authenticated !== 200) throw new Error("Desktop session authorization failed");
  await page.evaluate(() => { window.__smokeMetrics = []; window.addEventListener("ifc-fragment-metrics", e => window.__smokeMetrics.push(e.detail)); });
  await page.locator('input[type="file"]').setInputFiles(process.env.IFC_E2E_MODEL_PATH || path.join(root, "benchmarks/results/watchlist-browser-cache/845122873cfe408fbf537841dcdfc17f8b1d0e365a171abc8585ef7a2861eeac.ifc"));
  await page.waitForFunction(() => window.__smokeMetrics.length === 1, null, { timeout: 120000 });
  for (let i = 0; i < 240; i++) {
    results.loaded = await page.evaluate(async () => {
      const { token } = await window.pywebview.api.get_api_session();
      const runtime = await (await fetch("/model/runtime", { headers: { "X-IFC-Session": token } })).json();
      return { geometry: window.__smokeMetrics.length, activeModel: runtime.hasActiveModel, hotIndexStatus: runtime.hotIndexStatus, coldIndexStatus: runtime.coldIndexStatus, semanticProgress: runtime.semanticProgress };
    });
    if (results.loaded.coldIndexStatus === "ready") break;
    await pause(500);
  }
  if (!results.loaded.activeModel || results.loaded.hotIndexStatus !== "ready" || results.loaded.coldIndexStatus !== "ready") throw new Error("Desktop semantic indexing did not complete");
  if (results.loaded.semanticProgress.completed !== results.loaded.semanticProgress.total) throw new Error("Final semantic progress is incomplete");
  await page.waitForFunction(() => document.querySelector(".semantic-status")?.textContent.includes("sẵn sàng"), null, { timeout: 10000 });
  results.errors = errors;
  if (errors.length) throw new Error("Desktop JavaScript errors occurred");
  results.status = "passed";
} catch (error) { results.status = "failed"; results.error = String(error); throw error; }
finally {
  await writeFile(stopFile, "stop");
  for (let i = 0; i < 100 && child.exitCode === null; i++) await pause(200);
  if (child.exitCode === null) { child.kill(); results.shutdown = "timeout"; } else results.shutdown = child.exitCode;
  await browser?.close().catch(() => {});
  await writeFile(path.join(out, "result.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output: out, ...results }));
  if (results.shutdown !== 0) process.exitCode = 1;
}
