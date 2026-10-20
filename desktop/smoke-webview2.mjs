/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const desktop = dirname(fileURLToPath(import.meta.url));
const nativeMode = process.env.IFC_NATIVE_SMOKE === '1';
const reportDir = process.env.IFCLITE_AUDIT_DIR
  ? resolve(desktop, '..', process.env.IFCLITE_AUDIT_DIR)
  : join(desktop, 'reports');
await mkdir(reportDir, { recursive: true });
const server = createServer();
await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
const port = server.address().port;
await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-desktop-smoke-'));
const exe = process.env.SMOKE_EXE || join(desktop, 'src-tauri/target/release/ifc-lite-desktop.exe');
const child = spawn(exe, [], {
  windowsHide: true,
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run` },
  stdio: 'inherit',
});
let launchError;
child.on('error', error => { launchError = error; });
let browser;
let page;
const errors = [];
const diagnostics = [];
const result = { executable: exe, tests: [], errors, diagnostics };
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
  if (!ready) throw new Error('WebView2 debugging endpoint did not open');
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts().flatMap(context => context.pages())[0];
  if (!page) throw new Error('Missing desktop WebView2 page');
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('requestfailed', request => diagnostics.push(`request failed: ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', response => {
    if (response.request().resourceType() === 'script' && response.headers()['content-type']?.includes('text/html')) {
      diagnostics.push(`HTML returned for script: ${response.url()}`);
    }
  });
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) diagnostics.push(`${message.type()}: ${message.text()}`);
  });
  if (process.env.SMOKE_URL) await page.goto(process.env.SMOKE_URL);
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__, null, { timeout: 60000 });
  if (nativeMode) {
    await page.addInitScript(() => {
      globalThis.__nativeWasmInstantiations = 0;
      const instantiate = WebAssembly.instantiate.bind(WebAssembly);
      WebAssembly.instantiate = (...args) => { globalThis.__nativeWasmInstantiations++; return instantiate(...args); };
      const streaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
      WebAssembly.instantiateStreaming = (...args) => { globalThis.__nativeWasmInstantiations++; return streaming(...args); };
    });
    const url = new URL(page.url());
    if (process.env.IFC_NATIVE_DEFAULT === '1') {
      assert.equal(url.searchParams.has('engine'), false, 'preview launches without an engine override');
      assert.equal(await page.evaluate(() => !!globalThis.__IFCLITE_NATIVE__), true, 'preview enables native by default');
      result.tests.push({ name: 'native preview default engine without URL override' });
    } else url.searchParams.set('engine', 'native');
    await page.goto(url.href);
    await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__ && !!globalThis.__IFCLITE_NATIVE__);
    result.nativeBackend = await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('native_backend_info'));
    if (process.env.IFCLITE_EXPECT_ENGINE_VERSION) {
      assert.equal(result.nativeBackend.engineVersion, process.env.IFCLITE_EXPECT_ENGINE_VERSION);
    }
  }
  result.runtime = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return { url: location.href, secureContext: isSecureContext, crossOriginIsolated,
      webgpu: !!adapter, adapter: adapter?.info, userAgent: navigator.userAgent };
  });
  if (!result.runtime.webgpu) throw new Error('WebGPU adapter unavailable in packaged app');
  const modelState = () => page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return Array.from(s.models.values(), m => ({ name: m.name,
      meshes: m.geometryResult?.meshes?.length ?? 0, visible: m.visible }));
  });
  const input = page.locator('#file-input-open');
  await input.setInputFiles(resolve(desktop, '../apps/viewer/public/samples/building-architecture.ifc'));
  await page.waitForFunction(() => {
    const state = globalThis.__ifc_lite_viewer_store__.getState();
    const models = Array.from(state.models.values());
    return !state.loading && models.length === 1 && models[0].geometryResult?.meshes?.length > 0;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  result.tests.push({ name: 'local IFC import', models: await modelState() });
  // The custom desktop starts with a collapsed ribbon. Open it through the
  // visible control before exercising its tools with real pointer input.
  if (await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().ribbonCollapsed)) {
    await page.getByRole('button', { name: 'Expand the ribbon', exact: true }).click();
    await page.waitForFunction(() => !globalThis.__ifc_lite_viewer_store__.getState().ribbonCollapsed);
    await page.waitForTimeout(450);
  }
  if (process.env.TESTIFC_SECTION_BOX_SMOKE === '1') {
    const { testTestIfcSectionBox } = await import('./testifc-section-box-smoke.mjs');
    await testTestIfcSectionBox(page, result, reportDir);
  }
  if (process.env.TESTIFC_NAVIGATION_SMOKE === '1') {
    const { testTestIfcNavigation } = await import('./testifc-navigation-smoke.mjs');
    await testTestIfcNavigation(page, result, reportDir);
  }
  if (process.env.ENGINE_SNAPSHOT_LABEL) {
    const snapshot = await page.evaluate(() => {
      const m = [...globalThis.__ifc_lite_viewer_store__.getState().models.values()][0];
      const c = m.geometryResult.coordinateInfo;
      const rtc = c.wasmRtcOffset ?? { x: 0, y: 0, z: 0 }, shift = c.originShift;
      return { source: m.name, loadPath: m.loadPath, coordinateInfo: c,
        meshes: m.geometryResult.meshes.map(mesh => {
          const origin = mesh.origin ?? [0, 0, 0], vertices = [];
          for (let i = 0; i < mesh.positions.length; i += 3) vertices.push([
            mesh.positions[i] + origin[0] + shift.x + rtc.x,
            mesh.positions[i + 1] + origin[1] + shift.y + rtc.z,
            mesh.positions[i + 2] + origin[2] + shift.z - rtc.y]);
          return { expressId: mesh.expressId - m.idOffset, color: mesh.color,
            vertices, indices: Array.from(mesh.indices), geometryClass: mesh.geometryClass ?? 0 };
        }) };
    });
    await writeFile(join(reportDir, `engine-${process.env.ENGINE_SNAPSHOT_LABEL}.json`), JSON.stringify(snapshot));
  }
  assert.equal(await page.locator('.testifc-viewcube .view-cube__surface').count(), 26, 'TestIFC beveled cube replaces upstream cube');
  assert.notEqual(await page.locator('.view-cube__surface--face').first().evaluate(el => getComputedStyle(el).backgroundImage), 'none', 'Cube faces have their theme colors');
  const pose = () => page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint());
  const navigation = page.getByTestId('viewcube-navigation');
  const checks = [['left', [-1, 0, 0]], ['right', [1, 0, 0]], ['top', [0, 1, 0]],
    ['bottom', [0, -1, 0]], ['front', [0, 0, 1]], ['back', [0, 0, -1]]];
  for (const [name, direction] of checks) {
    await navigation.locator(`.view-controls .${name}-view`).click();
    await page.waitForFunction(expected => {
      const p = globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint();
      const d = [p.position.x - p.target.x, p.position.y - p.target.y, p.position.z - p.target.z];
      return d.reduce((sum, value, i) => sum + value * expected[i], 0) / Math.hypot(...d) > .995;
    }, direction);
    await page.waitForTimeout(350);
    assert.equal(await navigation.locator(`.${name}-view`).getAttribute('aria-pressed'), 'true');
  }
  result.tests.push({ name: 'six native Y-up camera views', directions: checks });
  await navigation.locator('.top-view').click();
  await page.waitForTimeout(400);
  const beforeRoll = await navigation.locator('.view-cube__body').getAttribute('style');
  await navigation.locator('.top-view').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(450);
  assert.notEqual(await navigation.locator('.view-cube__body').getAttribute('style'), beforeRoll, 'Cube tracks native preset roll');
  result.tests.push({ name: 'keyboard preset and camera roll sync' });
  const beforeDrag = await pose();
  const stage = await navigation.locator('.view-cube__stage').boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 42, stage.y + stage.height / 2 + 18, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.notDeepEqual((await pose()).position, beforeDrag.position, 'Cube drag changes native camera');
  result.tests.push({ name: 'cube pointer drag orbits the model' });
  await navigation.locator('.home-view').click();
  await page.waitForTimeout(450);
  await navigation.locator('[data-direction-key="1:1:1"]').click();
  await page.waitForTimeout(450);
  const cornerPose = await pose();
  const cornerDirection = [cornerPose.position.x - cornerPose.target.x, cornerPose.position.y - cornerPose.target.y, cornerPose.position.z - cornerPose.target.z];
  assert.ok(cornerDirection.every(v => Math.abs(v / Math.hypot(...cornerDirection) - 1 / Math.sqrt(3)) < .001));
  await navigation.locator('[data-direction-key="1:1:0"]').click();
  await page.waitForTimeout(450);
  const edgePose = await pose();
  assert.ok(Math.abs(edgePose.position.z - edgePose.target.z) < .001);
  assert.ok(Math.abs((edgePose.position.x - edgePose.target.x) - (edgePose.position.y - edgePose.target.y)) < .001);
  result.tests.push({ name: 'pointer corner and edge clicks move the native camera' });
  await navigation.locator('.home-view').click();
  await page.waitForTimeout(450);
  await page.mouse.move(400, 450);
  await page.screenshot({ path: join(reportDir, 'viewcube.png') });
  await page.screenshot({ path: join(reportDir, 'single-model.png') });
  await page.locator('#file-input-add').setInputFiles(resolve(desktop, '../apps/viewer/public/samples/building-architecture-rev-b.ifc'));
  await page.waitForFunction(() => {
    const state = globalThis.__ifc_lite_viewer_store__.getState();
    const models = Array.from(state.models.values());
    return !state.loading && models.length === 2 && models.every(m => m.geometryResult?.meshes?.length > 0);
  }, null, { timeout: 120000 });
  result.tests.push({ name: 'two-model import completes and clears loading overlay', models: await modelState() });
  if (nativeMode) {
    const native = await page.evaluate(() => {
      const models = [...globalThis.__ifc_lite_viewer_store__.getState().models.values()];
      return { wasmInstantiations: globalThis.__nativeWasmInstantiations,
        models: models.map(m => ({ loadPath: m.loadPath, sourceBytes: m.ifcDataStore.source.byteLength,
          entityCount: m.ifcDataStore.entityCount, propertySets: m.ifcDataStore.properties.getForEntity(52),
          hierarchy: !!m.ifcDataStore.spatialHierarchy, bounds: m.geometryResult.coordinateInfo.shiftedBounds })) };
    });
    assert.equal(native.wasmInstantiations, 0, 'native IFC route initializes no WASM engine');
    for (const model of native.models) {
      assert.equal(model.loadPath, 'native'); assert.equal(model.sourceBytes, 0);
      assert.ok(model.entityCount > 0); assert.ok(model.hierarchy);
    }
    result.tests.push({ name: 'native IFC source stays outside WebView2; BIM tables and federation', ...native });
    // Exercise the actual Properties component against native hydrated tables.
    // Select through public store actions so the known slab/Pset is deterministic.
    await page.evaluate(() => {
      const s = globalThis.__ifc_lite_viewer_store__.getState();
      const m = [...s.models.values()][0];
      s.setSelectedEntityId(m.idOffset + 52);
      s.setSelectedEntity({ modelId: m.id, expressId: 52 });
    });
    await page.getByText('Pset_SlabCommon', { exact: true }).first().waitFor({ state: 'visible' });
    await page.screenshot({ path: join(reportDir, 'native-properties.png') });
    result.tests.push({ name: 'native Properties component displays selected slab Pset without source bytes' });
    await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().clearSelection());
  }
  await page.locator('[data-tour="tool-section"]').click();
  await page.locator('[data-tool-bar="section"]').getByRole('radio', { name: 'Box', exact: true }).click();
  const { sweepCurrentBox } = await import('./testifc-section-box-smoke.mjs');
  await sweepCurrentBox(page);
  await page.waitForFunction(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return s.sectionPlane.enabled && !!s.sectionPlane.box && s.models.size === 2;
  });
  result.tests.push({ name: 'two-model Box sweep commits active clipping through real pointer input', size: await page.getByTestId('section-box-size').innerText() });
  await page.waitForTimeout(1000);
  result.visibleWarnings = await page.getByText(/Could not align/).allTextContents();
  result.federationReferences = await page.evaluate(() => [...globalThis.__ifc_lite_viewer_store__.getState().models.values()].map(model => ({
    name: model.name, spatialReference: model.spatialReference,
    georeferencing: model.ifcDataStore?.georeferencing,
    coordinateInfo: model.geometryResult?.coordinateInfo,
  })));
  result.sectionBoxEvents = await page.evaluate(() => globalThis.__testIfcBoxSweepEvents ?? []);
  await page.screenshot({ path: join(reportDir, 'two-model-section.png') });
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  result.passed = true;
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.passed = false;
  result.failure = error.stack;
  if (page && !page.isClosed()) result.sectionBoxEvents = await page.evaluate(() => globalThis.__testIfcBoxSweepEvents ?? []);
  if (page) await page.screenshot({ path: join(reportDir, 'failure.png') }).catch(screenshotError => diagnostics.push(String(screenshotError)));
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await writeFile(join(reportDir, nativeMode ? 'smoke-native.json' : 'smoke.json'), JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  if (child.pid && child.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
