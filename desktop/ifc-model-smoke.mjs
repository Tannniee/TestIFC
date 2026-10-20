/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const desktop = dirname(fileURLToPath(import.meta.url));
const reports = join(desktop, 'reports');
await mkdir(reports, { recursive: true });
const server = createServer();
await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
const port = server.address().port;
await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-recheck-'));
const child = spawn(process.env.SMOKE_EXE || join(desktop, 'src-tauri/target/release/ifc-lite-desktop.exe'), [], {
  windowsHide: true,
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run` },
  stdio: 'inherit',
});
let launchError;
child.on('error', error => { launchError = error; });
let browser, page;
const report = { runtime: 'Packaged WebView2', errors: [] };

report.console = [];
report.states = [];
try {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Desktop exited: ${child.exitCode}`);
    try { ready = (await fetch(`${endpoint}/json/version`)).ok; }
    catch (error) { if (Date.now() >= deadline) throw error; }
    if (ready) break;
    await new Promise(yes => setTimeout(yes, 250));
  }
  if (!ready) throw new Error('WebView2 endpoint did not open');
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts().flatMap(context => context.pages())[0];
  page.on('pageerror', error => report.errors.push(error.stack || error.message));
  page.on('console', message => report.console.push({ type: message.type(), text: message.text() }));
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__, null, { timeout: 60000 });
  report.url = page.url();
  report.native = await page.evaluate(() => !!globalThis.__IFCLITE_NATIVE__);
  assert.ok(process.env.IFC_MODEL_FILE, 'IFC_MODEL_FILE must name a local IFC file');
  await page.evaluate(() => {
    globalThis.__modelSmokeWasm = 0;
    const instantiate = WebAssembly.instantiate.bind(WebAssembly);
    WebAssembly.instantiate = (...args) => { globalThis.__modelSmokeWasm++; return instantiate(...args); };
    const streaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
    WebAssembly.instantiateStreaming = (...args) => { globalThis.__modelSmokeWasm++; return streaming(...args); };
    globalThis.__ifc_lite_viewer_store__.getState().setTheme('oled');
  });
  await page.locator('#file-input-open').setInputFiles(process.env.IFC_MODEL_FILE);
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const s = globalThis.__ifc_lite_viewer_store__.getState();
      return { loading: s.loading, loadError: s.loadError, loadingProgress: s.loadingProgress,
        loadingPhase: s.loadingPhase, models: [...s.models.values()].map(m => ({
          id: m.id, loadPath: m.loadPath, error: m.loadError,
          meshes: m.geometryResult?.meshes?.length, entities: m.ifcDataStore?.entityCount,
          bounds: m.geometryResult?.coordinateInfo?.shiftedBounds,
        })), statusText: document.body.innerText.slice(-2000) };
    });
    report.states.push(state);
    if (!state.loading && (state.models.length || report.console.some(m => m.type === 'error'))) break;
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(reports, 'ifc-model-smoke.png') });
  const models = report.states.at(-1)?.models;
  assert.ok(models?.length === 1 && models[0].meshes > 0 && !models[0].error, 'The IFC model loads renderable geometry');
  if (process.env.IFC_EXPECT_MESHES) assert.equal(models[0].meshes, Number(process.env.IFC_EXPECT_MESHES));
  assert.equal(report.errors.length, 0, 'No page errors');
  assert.equal(report.console.filter(m => m.type === 'error').length, 0, 'No console errors');
  report.details = await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    const m = [...s.models.values()][0];
    return { loadPath: m.loadPath, sourceBytes: m.ifcDataStore.source.byteLength,
      uniqueGeometryIds: new Set(m.geometryResult.meshes.map(mesh => mesh.expressId)).size,
      vertices: m.geometryResult.meshes.reduce((n, mesh) => n + mesh.positions.length / 3, 0),
      triangles: m.geometryResult.meshes.reduce((n, mesh) => n + mesh.indices.length / 3, 0),
      wasmInstantiations: globalThis.__modelSmokeWasm, viewpoint: s.cameraCallbacks.getViewpoint() };
  });
  if (report.native) {
    assert.equal(report.details.loadPath, 'native');
    assert.equal(report.details.sourceBytes, 0);
    assert.equal(report.details.wasmInstantiations, 0);
  }
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  if (page) await page.screenshot({ path: join(reports, 'ifc-model-smoke-failure.png') });
  throw error;
} finally {
  await writeFile(join(reports, 'ifc-model-smoke.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  if (child.pid && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
