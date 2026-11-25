import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertClosedMesh } from './mesh-witness.mjs';

const dist = resolve(import.meta.dirname, '../../apps/viewer/dist');
const out = process.env.DIAG_OUT || join(import.meta.dirname, 'local-web');
await mkdir(out, { recursive: true });
const mime = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path === dist) path = join(dist, 'index.html');
    assert.ok(path.startsWith(dist + '\\'), 'path must stay in dist');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end(String(e)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const report = { url, started: new Date().toISOString(), cases: [], errors: [], blockedWrites: [] };
let browser;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, args: ['--enable-unsafe-webgpu'] });
  const root = 'F:/Steel/VBA/IFC-Lite/research/nhip-chinh-deep-20261024';
  for (const [name, file, host] of [
    ['reference', root + '/web-repro/minimal-original.ifc', 322443],
    ['body', root + '/body-repro/minimal-original.ifc', 2444],
    ['body-edge-notches', join(import.meta.dirname, 'remaining-body-298390/minimal-original.ifc'), 298390],
    ['concave-plate', join(import.meta.dirname, 'remaining-plate-150461/minimal-original.ifc'), 150461],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push({ name, error: e.stack }));
    await page.route('**/*', route => {
      const r = route.request();
      if (new URL(r.url()).origin === new URL(url).origin && ['GET', 'HEAD'].includes(r.method())) return route.continue();
      if (!['GET', 'HEAD'].includes(r.method())) report.blockedWrites.push({ url: r.url(), method: r.method() });
      return route.abort();
    });
    const wasmHashes = [];
    const wasmReads = [];
    page.on('response', r => {
      if (r.url().endsWith('.wasm') && r.ok()) {
        wasmReads.push(r.body().then(body => {
          wasmHashes.push({ url: r.url(), sha256: createHash('sha256').update(body).digest('hex') });
        }).catch(error => { report.errors.push({ name, error: String(error) }); }));
      }
    });
    await page.goto(url);
    await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__, null, { timeout: 180000 });
    assert.equal(await page.evaluate(() => !!globalThis.__IFCLITE_NATIVE__), false);
    await page.locator('#file-input-open').setInputFiles(file);
    await page.waitForFunction(() => {
      const s = globalThis.__ifc_lite_viewer_store__.getState();
      return !s.loading && (s.models.size === 1 || !!s.error);
    }, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => {
      const s = globalThis.__ifc_lite_viewer_store__.getState();
      const m = [...s.models.values()][0];
      return { loadError: s.error, loadPath: m?.loadPath, idOffset: m?.idOffset,
        diagnostics: m?.geometryResult?.diagnostics, coordinateInfo: m?.geometryResult?.coordinateInfo,
        meshes: m?.geometryResult?.meshes.map(x => ({ id: x.expressId, type: x.ifcType,
          color: Array.from(x.color), origin: x.origin, positions: Array.from(x.positions), indices: Array.from(x.indices) })) };
    });
    assert.ok(!state.loadError, state.loadError);
    const meshes = state.meshes.filter(m => m.id - state.idOffset === host);
    assert.ok(meshes.length > 0);
    for (const mesh of meshes) assertClosedMesh(mesh);
    const hostTriangles=meshes.reduce((n,m)=>n+m.indices.length/3,0);
    if (name === 'reference') assert.equal(state.meshes.length, 1, 'Reference cutters must emit no opaque sheets');
    await Promise.all(wasmReads);
    assert.ok(wasmHashes.some(r => r.sha256 === process.env.EXPECT_WASM_HASH), 'browser must load the qualified WASM binary');
    await page.screenshot({ path: join(out, name + '.png') });
    report.cases.push({ name, file, wasmHashes, ...state });
    console.log(JSON.stringify({ name, meshes: state.meshes.length, hostTriangles, diagnostics: state.diagnostics }));
    await context.close();
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  report.passed = true;
} catch (e) { report.failure = e.stack; }
finally {
  await browser?.close();
  await new Promise(r => server.close(r));
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure }));
  process.exit(report.passed ? 0 : 1);
}
