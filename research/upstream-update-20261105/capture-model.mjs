import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const exe = resolve(process.argv[2]);
const model = resolve(process.argv[3]);
const out = resolve(process.argv[4]);
await mkdir(out, { recursive: true });
const baseline = JSON.parse(await readFile('F:/Steel/VBA/IFC-Lite-Core104/research/nhip-load-20261027/packaged-r7/selected-meshes.json', 'utf8'));
const ids = baseline.meshes.map(mesh => mesh.expressId);
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-upgrade-model-'));
const child = spawn(exe, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
  WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run`,
} });
let browser, page, launchError;
child.on('error', error => { launchError = error; });
const report = { exe, model, profile, errors: [], diagnostics: [], samples: [],
  scope: 'Real packaged geometry and renderer qualification; concurrent test load means elapsed times are diagnostic, not an A/B performance verdict.' };
const save = () => writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
try {
  const endpoint = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 120; n++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Host exited ${child.exitCode}`);
    try { if ((await fetch(`${endpoint}/json/version`)).ok) break; }
    catch (error) { if (n === 119) throw error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts()[0].pages()[0];
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type()) && report.diagnostics.length < 1000) report.diagnostics.push(message.text()); });
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__ && !!globalThis.__IFCLITE_NATIVE__);
  report.exeSha256 = createHash('sha256').update(await readFile(exe)).digest('hex');
  report.modelSha256 = createHash('sha256').update(await readFile(model)).digest('hex');
  report.native = await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('native_backend_info'));
  await page.bringToFront();
  const started = Date.now();
  await page.locator('#file-input-open').setInputFiles(model);
  let ready = false;
  for (let n = 0; n < 1200; n++) {
    await page.waitForTimeout(1000);
    const sample = await page.evaluate(() => {
      const s = globalThis.__ifc_lite_viewer_store__.getState();
      const m = [...s.models.values()][0];
      return { loading: s.loading, error: s.error ?? s.loadError, progress: s.progress,
        streaming: s.geometryStreamingActive, loadPath: m?.loadPath, meshes: m?.geometryResult?.meshes.length,
        triangles: m?.geometryResult?.totalTriangles, vertices: m?.geometryResult?.totalVertices };
    });
    sample.elapsedMs = Date.now() - started;
    if (n % 5 === 0 || !sample.loading) { report.samples.push(sample); await save(); console.log(JSON.stringify(sample)); }
    assert.ok(!sample.error, sample.error);
    if (!sample.loading && !sample.streaming && sample.meshes > 0) { ready = true; report.ready = sample; break; }
  }
  assert.ok(ready, 'native model reached the complete geometry boundary');
  await page.waitForTimeout(15000);
  const capture = await page.evaluate(ids => {
    const s = globalThis.__ifc_lite_viewer_store__.getState(), m = [...s.models.values()][0];
    const wanted = new Set(ids), meshes = [];
    for (const mesh of m.geometryResult.meshes) {
      const id = mesh.expressId - m.idOffset;
      if (!wanted.has(id)) continue;
      meshes.push({ expressId: id, type: mesh.ifcType, positions: Array.from(mesh.positions),
        indices: Array.from(mesh.indices), origin: mesh.origin, color: mesh.color });
    }
    return { loading: s.loading, error: s.error ?? s.loadError, loadPath: m.loadPath, modelName: m.name,
      coordinateInfo: m.geometryResult.coordinateInfo, idOffset: m.idOffset,
      stats: globalThis.__ifc_lite_render_stats__?.(), meshCount: m.geometryResult.meshes.length, meshes,
      missing: ids.filter(id => !meshes.some(mesh => mesh.expressId === id)) };
  }, ids);
  await writeFile(join(out, 'selected-meshes.json'), JSON.stringify(capture));
  report.missing = capture.missing;
  report.stats = capture.stats;
  await page.screenshot({ path: join(out, 'loaded.png') });
  assert.equal(capture.loadPath, 'native');
  assert.equal(capture.missing.length, 0, 'all qualified r7 geometry samples remain available');
  assert.equal(report.errors.length, 0);
  report.ok = true;
} catch (error) {
  report.failure = error.stack;
  if (page) await page.screenshot({ path: join(out, 'failure.png') }).catch(error => report.diagnostics.push(String(error)));
  process.exitCode = 1;
} finally {
  await save();
  if (browser) await browser.close();
  if (child.exitCode === null) child.kill();
}
