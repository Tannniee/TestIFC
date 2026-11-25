import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';

const exe = process.env.DIAG_EXE;
assert.ok(exe, 'DIAG_EXE must identify the exact packaged candidate');
const model = process.env.DIAG_MODEL || 'F:/Working/IFC Temp/Nhip chinh.ifc';
const out = process.env.DIAG_OUT || join(import.meta.dirname, 'packaged-original');
await mkdir(out, { recursive: true });
const server = createServer();
await new Promise((yes, no) => { server.on('error', no); server.listen(0, '127.0.0.1', yes); });
const port = server.address().port;
await new Promise((yes, no) => server.close(e => e ? no(e) : yes()));
const started = performance.now();
const report = { exe, model, started: new Date().toISOString(), states: [], errors: [], console: [], tests: [] };
for (const [key, path] of [['exeSha256', exe], ['modelSha256', model]]) {
  report[key] = createHash('sha256').update(await readFile(path)).digest('hex');
}
const child = spawn(exe, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(out, `profile-${Date.now()}`),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run`,
} });
report.pid = child.pid;
child.stdout.on('data', b => void appendFile(join(out, 'stdout.log'), b));
child.stderr.on('data', b => void appendFile(join(out, 'stderr.log'), b));
child.on('error', e => report.errors.push(String(e)));
child.on('exit', (code, signal) => { report.exit = { code, signal }; });
let page;
let browser;
const log = async row => {
  row.seconds = +( (performance.now() - started) / 1000).toFixed(3);
  await appendFile(join(out, 'events.jsonl'), JSON.stringify(row) + '\n');
  return row;
};
try {
  const deadline = performance.now() + 60000;
  for (;;) {
    assert.equal(child.exitCode, null, 'host exited before its WebView opened');
    let connected = false;
    try { connected = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; }
    catch (e) { if (performance.now() > deadline) throw e; }
    if (connected) break;
    assert.ok(performance.now() < deadline, 'WebView connection timed out');
    await new Promise(r => setTimeout(r, 250));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts().flatMap(c => c.pages())[0];
  page.on('pageerror', e => report.errors.push(e.stack));
  page.on('crash', () => report.errors.push('WebView renderer crashed'));
  page.on('console', m => {
    if (['error', 'warning'].includes(m.type())) report.console.push({ type: m.type(), text: m.text() });
  });
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__, null, { timeout: 60000 });
  report.backend = await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('native_backend_info'));
  await page.evaluate(() => {
    const runtime = globalThis.__IFCLITE_NATIVE__;
    const original = runtime.load;
    runtime.load = async function (...args) {
      const value = await original.apply(this, args);
      globalThis.__acceptResult = { stats: value.stats, diagnostics: value.diagnostics };
      return value;
    };
  });
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input-open' });
  const loadStart = performance.now();
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [model] });
  const loadDeadline = loadStart + Number(process.env.LOAD_TIMEOUT_MS || 900000);
  for (let i = 0; ; i++) {
    assert.equal(child.exitCode, null, 'host exited during IFC load');
    assert.ok(performance.now() < loadDeadline, 'original IFC load timed out');
    await new Promise(r => setTimeout(r, 1000));
    const probeStart = performance.now();
    const state = await page.evaluate(() => {
      const s = globalThis.__ifc_lite_viewer_store__.getState();
      const n = globalThis.__acceptResult;
      return { loading: s.loading, loadError: s.error, progress: s.progress,
        native: { done: !!n, stats: n?.stats, diagnostics: n?.diagnostics },
        models: [...s.models.values()].map(m => ({ name: m.name, path: m.loadPath,
          meshes: m.geometryResult?.meshes?.length, entities: m.ifcDataStore?.entityCount })) };
    });
    const row = await log({ state, requestMs: +(performance.now() - probeStart).toFixed(1) });
    report.states.push(row);
    if (i % 10 === 0) {
      console.log(JSON.stringify(row));
      await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
    }
    assert.ok(!state.loadError, String(state.loadError));
    assert.ok(!state.native.error, String(state.native.error));
    if (!state.loading && state.models.length) {
      assert.equal(state.native.done, true);
      assert.ok(state.models[0].meshes > 0);
      report.loadSeconds = +( (performance.now() - loadStart) / 1000).toFixed(3);
      break;
    }
  }
  await page.waitForTimeout(1500);
  report.tests.push('original IFC reaches Ready using the native backend');
  await page.screenshot({ path: join(out, 'ready.png') });
  const meshEvidence = await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    const m = [...s.models.values()][0];
    const selected = new Set([434, 820, 2361, 2444, 64951, 266636, 322443, 344051, 322462,
      298390, 303995, 304217, 150461, 152785,
      178955,281338,448868,460997,490757,464047,472872,809515,817569,818684,
      824437,825013,830064,831471,831549,836117,836248,837397,842718,845196,845414,
      473164,473277,473789,473865,471627,473024,473532,257768,258582,258648,286665,
      286744,286882,286961,287038,292599,15785,89056,178623,198892,248619,10217,
      714937,618305,704523,615144,647471,679523,725690,566424,665548,625141,319371]);
    const features = m.geometryResult.meshes.filter(mesh => ['IfcVoidingFeature', 'IfcOpeningElement'].includes(mesh.ifcType));
    return { coordinateInfo: m.geometryResult.coordinateInfo, idOffset: m.idOffset,
      openingsVisible: s.typeVisibility.openings,
      featureMeshes: features.length, opaqueFeatures: features.filter(mesh => mesh.color[3] >= .99).length,
      meshes: m.geometryResult.meshes.filter(mesh => selected.has(mesh.expressId - m.idOffset)).map(mesh => ({
        expressId: mesh.expressId - m.idOffset, type: mesh.ifcType, positions: Array.from(mesh.positions),
        origin: mesh.origin, indices: Array.from(mesh.indices), color: mesh.color,
      })) };
  });
  await writeFile(join(out, 'selected-meshes.json'), JSON.stringify(meshEvidence));
  assert.equal(meshEvidence.openingsVisible, false);
  assert.equal(meshEvidence.opaqueFeatures, 0);
  assert.ok(!meshEvidence.meshes.some(m => m.expressId === 322462), 'Reference-only blue feature must emit no mesh');
  report.meshEvidence = { ...meshEvidence, meshes: meshEvidence.meshes.map(m => ({ id: m.expressId, triangles: m.indices.length / 3 })) };
  report.tests.push('Reference feature #322462 absent; all optional Body feature meshes are transparent and hidden');
  const pose = () => page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint());
  const before = await pose();
  const rect = await page.locator('canvas[data-viewport="main"]').boundingBox();
  await page.mouse.move(rect.x + rect.width * .48, rect.y + rect.height * .5);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(500);
  const zoom = await pose();
  assert.notDeepEqual(zoom, before, 'real mouse wheel must change the camera');
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .48 + 70, rect.y + rect.height * .5 + 25, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1800);
  assert.notDeepEqual(await pose(), zoom, 'real pointer drag must orbit the loaded bridge');
  await page.getByTestId('viewcube-navigation').locator('.home-view').click();
  await page.waitForTimeout(700);
  await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .52);
  for (let i = 0; i < 28; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, 'bridge-closeup.png') });
  await page.screenshot({ path: join(out, 'after-navigation.png') });
  report.tests.push('real wheel, pointer orbit and visible Home control respond on the full bridge');
  const nativeStats = report.states.at(-1).state.native.stats;
  assert.equal(nativeStats.total_csg_failures, 0, 'full-model geometry must have no residual CSG failures');
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  report.passed = true;
} catch (e) {
  report.failure = e.stack;
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: join(out, 'failure.png'), timeout: 5000 }); }
    catch (screenshotError) { report.screenshotError = String(screenshotError); }
  }
} finally {
  if (page && !page.isClosed() && child.exitCode === null) {
    try { await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })); }
    catch (e) { report.closeRequest = String(e); }
  }
  for (let i = 0; i < 50 && child.exitCode === null; i++) await new Promise(r => setTimeout(r, 100));
  report.cleanExit = child.exitCode === 0;
  if (child.exitCode === null && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  report.finished = new Date().toISOString();
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, loadSeconds: report.loadSeconds, failure: report.failure, report: join(out, 'report.json') }));
  process.exit(report.passed ? 0 : 1);
}
