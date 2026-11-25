// Real native WebView2 acceptance probe. Uses the repository's CDP test setup.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const previewOnly = process.env.COLORIZER_PREVIEW_ONLY === '1';
const dir = resolve(import.meta.dirname, previewOnly ? 'native-preview' : 'native-ui');
await mkdir(dir, { recursive: true });
const exe = resolve(import.meta.dirname, '../..', process.env.SMOKE_EXE || 'desktop/release/10.3.0-native-colorizer-20261016-r2/IFC-Lite.exe');
const model = 'F:/Steel/VBA/IFC COLO/hangarvd_f10_ tan base_f01_colored.ifc';
const listener = createServer();
await new Promise(yes => listener.listen(0, '127.0.0.1', yes));
const port = listener.address().port;
await new Promise(yes => listener.close(yes));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-colorizer-'));
const child = spawn(exe, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
  WEBVIEW2_USER_DATA_FOLDER: profile,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run`,
} });
let launchError;
child.on('error', error => { launchError = error; });
let browser, page;
const result = { exe, model, profile, assertions: [], errors: [], warnings: [] };
const passed = (name, evidence) => result.assertions.push({ name, evidence });
try {
  const endpoint = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Native host exited: ${child.exitCode}`);
    try { if ((await fetch(`${endpoint}/json/version`)).ok) break; }
    catch (error) { if (attempt === 119) throw error; }
    await new Promise(yes => setTimeout(yes, 500));
  }
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts().flatMap(context => context.pages())[0];
  assert.ok(page);
  page.on('pageerror', error => result.errors.push(error.stack || error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) result.warnings.push(message.text()); });
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__ && !!globalThis.__IFCLITE_COLORIZER__, null, { timeout: 60000 });
  console.log('Native host ready');
  assert.equal(await page.evaluate(() => !!globalThis.__IFCLITE_NATIVE__), true);
  await page.locator('#file-input-open').setInputFiles(model);
  await page.waitForFunction(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return !s.loading && s.models.size === 1 && [...s.models.values()][0].geometryResult?.meshes.length > 0;
  }, null, { timeout: 180000 });
  const loaded = await page.evaluate(() => {
    const m = [...globalThis.__ifc_lite_viewer_store__.getState().models.values()][0];
    return { sourceBytes: m.ifcDataStore.source.byteLength, loadPath: m.loadPath,
      meshes: m.geometryResult.meshes.length, name: m.name,
      vertices: m.geometryResult.totalVertices, triangles: m.geometryResult.totalTriangles,
      products: new Set([...m.geometryResult.meshes.map(mesh => mesh.expressId), ...(m.geometryResult.instancedGeometryAabbs?.keys() ?? [])]).size };
  });
  assert.equal(loaded.sourceBytes, 0);
  passed('native model remains source-less before and after opt-in preparation', loaded);
  console.log('Native model loaded', loaded);
  await page.getByRole('tab', { name: 'Author', exact: true }).click();
  await page.locator('[data-command-id="tool:edit-mode"]').click();
  if (previewOnly) {
    await page.locator('[data-storey-context]').click();
    await page.getByRole('radio', { name: 'Show all', exact: true }).click();
    await page.keyboard.press('Escape');
  }
  await page.locator('[data-command-id="panel:colorizer"]').click();
  const panel = page.getByRole('region', { name: 'Colorizer', exact: true });
  const preparing = performance.now();
  await panel.getByRole('button', { name: 'Prepare model', exact: true }).click();
  await panel.getByText('75 groups · 14509 objects · 0 painted', { exact: true }).waitFor({ timeout: 120000 });
  assert.equal(await page.evaluate(() => [...globalThis.__ifc_lite_viewer_store__.getState().models.values()][0].ifcDataStore.source.byteLength), 0);
  passed('source preparation and section discovery', { elapsedMs: performance.now() - preparing, groups: 75, products: 14509 });
  console.log('Colorizer catalog ready');
  await page.screenshot({ path: join(dir, '01-original.png') });
  await panel.getByRole('button', { name: 'Paint whole model gray', exact: true }).click();
  const paints = () => page.evaluate(() => {
    const colors = globalThis.__ifc_lite_viewer_store__.getState().overlayLayers.get('colorizer-preview')?.colorOverrides;
    const counts = {};
    for (const color of colors?.values() ?? []) { const key = color.join(','); counts[key] = (counts[key] ?? 0) + 1; }
    return counts;
  });
  assert.deepEqual(await paints(), { '0.5019607843137255,0.5019607843137255,0.5019607843137255,1': 14509 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(dir, '02-all-gray.png') });
  await panel.getByRole('checkbox', { name: 'Select group PIPE-267.4X8', exact: true }).check();
  await panel.getByRole('button', { name: 'Paint selected groups', exact: true }).click();
  const final = { '1,0,0,1': 1968, '0.5019607843137255,0.5019607843137255,0.5019607843137255,1': 12541 };
  assert.deepEqual(await paints(), final);
  await panel.getByRole('button', { name: 'Undo colour', exact: true }).click();
  assert.equal(Object.keys(await paints()).length, 1);
  await panel.getByRole('button', { name: 'Redo colour', exact: true }).click();
  assert.deepEqual(await paints(), final);
  passed('whole-model gray then PIPE red, including undo/redo', final);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(dir, '03-gray-red.png') });
  console.log('Preview gray/red and undo/redo passed');
  if (!previewOnly) {
  // Capture exactly the Blob sent to the download anchor, avoiding an OS dialog.
  await page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith('_colored.ifc')) {
        globalThis.__colorizerDownload = { name: this.download, bytes: fetch(this.href).then(r => r.arrayBuffer()) };
      } else original.call(this);
    };
  });
  const exporting = performance.now();
  await panel.getByRole('button', { name: 'Export coloured IFC', exact: true }).click();
  await panel.getByText('Coloured IFC exported.', { exact: true }).waitFor({ timeout: 120000 });
  const download = await page.evaluate(async () => ({ name: globalThis.__colorizerDownload.name,
    bytes: Array.from(new Uint8Array(await globalThis.__colorizerDownload.bytes)) }));
  const output = join(dir, 'ui-gray-red.ifc');
  await writeFile(output, new Uint8Array(download.bytes));
  passed('real UI export produces a full STEP file', { output, bytes: download.bytes.length, suggestedName: download.name, elapsedMs: performance.now() - exporting });
  console.log('UI download captured', download.bytes.length);
  await panel.getByRole('button', { name: 'Restore original colours', exact: true }).click();
  assert.deepEqual(await paints(), {});
  await page.locator('#file-input-open').setInputFiles(output);
  await page.waitForFunction(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return !s.loading && [...s.models.values()].some(m => m.name === 'ui-gray-red.ifc' && m.geometryResult?.meshes.length > 0);
  }, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(dir, '04-reopened.png') });
  const reopened = await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    const m = [...s.models.values()].find(m => m.name === 'ui-gray-red.ifc');
    const colors = {};
    for (const mesh of m.geometryResult.meshes) { const key = mesh.color.map(v => Math.round(v * 255)).join(','); colors[key] = (colors[key] ?? 0) + 1; }
    return { meshes: m.geometryResult.meshes.length, colors,
      vertices: m.geometryResult.totalVertices, triangles: m.geometryResult.totalTriangles,
      products: new Set([...m.geometryResult.meshes.map(mesh => mesh.expressId), ...(m.geometryResult.instancedGeometryAabbs?.keys() ?? [])]).size };
  });
  assert.equal(reopened.triangles, loaded.triangles);
  assert.equal(reopened.vertices, loaded.vertices);
  assert.equal(reopened.products, loaded.products);
  assert.ok(Object.keys(reopened.colors).every(color => ['255,0,0,255', '128,128,128,255'].includes(color)));
  passed('native IFC reopen retains geometry totals and persisted flat-mesh colours (instancing can repartition)', reopened);
  } else {
    await panel.getByRole('checkbox', { name: 'Select group PIPE-267.4X8', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(dir, '04-selected-group.png') });
  }
  assert.equal(result.errors.length, 0);
  result.ok = true;
} catch (error) {
  result.failure = error.stack || String(error);
  if (page) {
    result.body = await page.locator('body').innerText().catch(String);
    await page.screenshot({ path: join(dir, 'failure.png') }).catch(String);
  }
  process.exitCode = 1;
} finally {
  await writeFile(join(dir, 'report.json'), JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  if (child.exitCode === null) child.kill();
}
console.log(JSON.stringify({ ok: result.ok, assertions: result.assertions, failure: result.failure }, null, 2));
