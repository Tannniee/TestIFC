import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';

const exe = process.env.SMOKE_EXE;
const model = process.env.IFC_MODEL_FILE;
assert.ok(exe && model);
const out = resolve(import.meta.dirname, process.env.LARGE_MODEL_LABEL);
await mkdir(out, { recursive: true });
const server = createServer();
await new Promise(yes => server.listen(0, '127.0.0.1', yes));
const port = server.address().port;
await new Promise(yes => server.close(yes));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-core104-large-'));
const stdout = createWriteStream(join(out, 'host-stdout.log'));
const stderr = createWriteStream(join(out, 'host-stderr.log'));
const child = spawn(exe, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run`,
} });
child.stdout.pipe(stdout); child.stderr.pipe(stderr);
let browser, page, launchError;
child.on('error', error => { launchError = error; });
const report = { exe, model, bytes: (await stat(model)).size, profile, hostPid: child.pid, errors: [], progress: [] };
child.on('exit', (code, signal) => { report.hostExit = { code, signal, at: new Date().toISOString() }; });
const save = () => writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
try {
  for (let i = 0; i < 120; i++) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null);
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; }
    catch (error) { if (i === 119) throw error; }
    await new Promise(yes => setTimeout(yes, 500));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts().flatMap(c => c.pages())[0]; assert.ok(page);
  page.on('pageerror', error => report.errors.push(error.stack || error.message));
  page.on('crash', () => { report.rendererCrashed = true; });
  page.on('console', message => stderr.write(`[webview ${message.type()}] ${message.text()}\n`));
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__ && !!globalThis.__IFCLITE_NATIVE__);
  report.backend = await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('native_backend_info'));
  if (process.env.IFCLITE_EXPECT_ENGINE_VERSION) assert.equal(report.backend.engineVersion, process.env.IFCLITE_EXPECT_ENGINE_VERSION);
  await page.evaluate(() => {
    globalThis.__largeWasm = 0;
    for (const key of ['instantiate', 'instantiateStreaming']) {
      const original = WebAssembly[key].bind(WebAssembly);
      WebAssembly[key] = (...args) => { globalThis.__largeWasm++; return original(...args); };
    }
    globalThis.__ifc_lite_viewer_store__.getState().setTheme('oled');
  });
  const start = Date.now();
  // CDP attaches the local path directly; Playwright's remote file transport
  // refuses files above 50 MB even though this browser is on the same host.
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input-open' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [model] });
  await cdp.detach();
  for (let i = 0; i < 600; i++) {
    await page.waitForTimeout(1000);
    const state = await page.evaluate(() => {
      const s = globalThis.__ifc_lite_viewer_store__.getState();
      return { loading: s.loading, error: s.loadError, progress: s.progress,
        models: [...s.models.values()].map(m => ({ id: m.id, path: m.loadPath,
          meshes: m.geometryResult?.meshes.length, vertices: m.geometryResult?.totalVertices,
          triangles: m.geometryResult?.totalTriangles, sourceBytes: m.ifcDataStore?.source.byteLength })) };
    });
    report.progress.push({ milliseconds: Date.now() - start, ...state });
    await save();
    if (i % 10 === 0) console.log(JSON.stringify(report.progress.at(-1)));
    if (state.error) throw new Error(state.error);
    if (!state.loading && state.models.length === 1 && state.models[0].meshes > 0) break;
    assert.ok(i < 599, 'large model load finishes within ten minutes');
  }
  report.loaded = report.progress.at(-1);
  const prior = model.includes('SVD TRONG DONG') ? 'r2-svd' : model.includes('IFC_PVF') ? 'r2-pvf-diagnostic' : null;
  if (prior) {
    const baseline = JSON.parse(await readFile(resolve(import.meta.dirname, '../core-upgrade-20261017', prior, 'report.json'), 'utf8'));
    report.countComparison = {};
    for (const key of ['meshes', 'vertices', 'triangles']) {
      const actual = report.loaded.models[0][key], previous = baseline.loaded.models[0][key];
      assert.equal(actual, previous, `same input retains prior native ${key} count`);
      report.countComparison[key] = { previous, actual, identical: actual === previous };
    }
  }
  assert.equal(report.loaded.models[0].path, 'native');
  assert.equal(report.loaded.models[0].sourceBytes, 0);
  assert.equal(await page.evaluate(() => globalThis.__largeWasm), 0);
  await page.waitForTimeout(2500);
  const canvas = page.locator('canvas[data-viewport="main"]');
  await canvas.screenshot({ path: join(out, 'loaded.png') });
  const rect = await canvas.boundingBox(); assert.ok(rect);
  const pose = () => page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint());
  const before = await pose();
  const x = rect.x + rect.width * .52, y = rect.y + rect.height * .52;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 45, y + 20, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(1200);
  const orbit = await pose();
  assert.notDeepEqual(orbit.position, before.position, 'real orbit moves the camera');
  await page.mouse.move(x, y); await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 30, y + 15, { steps: 10 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(1200);
  const pan = await pose(); assert.notDeepEqual(pan.target, orbit.target);
  await page.mouse.wheel(0, -100); await page.waitForTimeout(500);
  const zoom = await pose(); assert.notEqual(zoom.orthoSize, pan.orthoSize);
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().clearSelection());
  for (let row = 1; row <= 7 && !report.selection; row++) {
    for (let column = 1; column <= 7 && !report.selection; column++) {
      await page.mouse.click(rect.x + rect.width * column / 8, rect.y + rect.height * row / 8);
      await page.waitForTimeout(100);
      report.selection = await page.evaluate(() => {
        const s = globalThis.__ifc_lite_viewer_store__.getState();
        return s.selectedEntityId === null ? null : s.resolveGlobalIdFromModels(s.selectedEntityId);
      });
    }
  }
  assert.ok(report.selection, 'real viewport click resolves a model-owned entity');
  await canvas.screenshot({ path: join(out, 'selected.png') });
  report.gestures = { before, orbit, pan, zoom };
  assert.equal(report.errors.length, 0);
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().clearAllModels());
  await page.waitForFunction(() => globalThis.__ifc_lite_viewer_store__.getState().models.size === 0);
  await page.waitForTimeout(1000);
  assert.equal(report.errors.length, 0, 'clearing a large model leaves no uncaught page error');
  report.cleared = true;
  report.ok = true;
  // Send the ordinary window close to this exact owned host. Tauri correctly
  // denies its JS window-close command under the app's existing ACL.
  const quotedExe = exe.replaceAll("'", "''");
  const close = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$coreAuditProcess = Get-Process -Id ${child.pid}; if ($coreAuditProcess.Path -ne '${quotedExe}') { throw 'Host identity changed' }; $coreAuditProcess.CloseMainWindow()`],
    { windowsHide: true, encoding: 'utf8' });
  report.closeRequested = close.status === 0 && /True/.test(close.stdout);
  report.closeResponse = { status: close.status, stdout: close.stdout, stderr: close.stderr };
} catch (error) {
  report.ok = false; report.failure = error.stack || String(error); process.exitCode = 1;
  if (page) await page.screenshot({ path: join(out, 'failure.png') }).catch(console.error);
} finally {
  await save();
  if (browser) await browser.close();
  for (let i = 0; i < 50 && child.exitCode === null; i++) await new Promise(yes => setTimeout(yes, 100));
  report.exitedAfterClose = child.exitCode !== null;
  if (report.errors.length > 0) {
    report.ok = false; report.failure ??= 'Uncaught page errors during load, interaction or cleanup'; process.exitCode = 1;
  }
  if (report.ok && !report.exitedAfterClose) {
    report.ok = false; report.failure = 'The owned app did not exit after its ordinary window close'; process.exitCode = 1;
  }
  if (child.exitCode === null) child.kill();
  await save();
}
console.log(JSON.stringify({ ok: report.ok, model, loaded: report.loaded, selection: report.selection, failure: report.failure }));
