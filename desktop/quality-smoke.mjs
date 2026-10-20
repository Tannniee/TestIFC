// Broad acceptance audit of the shipped native EXE; each failure is retained.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, process.env.IFCLITE_AUDIT_DIR || 'desktop/reports/quality');
await mkdir(dir, { recursive: true });
const exe = resolve(root, process.env.SMOKE_EXE || 'desktop/src-tauri/target/release/ifc-lite-desktop.exe');
const model = process.env.IFCLITE_AUDIT_MODEL;
if (!model) throw new Error('Set IFCLITE_AUDIT_MODEL to a real IFC file for packaged verification.');
const listener = createServer();
await new Promise(yes => listener.listen(0, '127.0.0.1', yes));
const port = listener.address().port;
await new Promise(yes => listener.close(yes));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-quality-audit-'));
const child = spawn(exe, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
  WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run`,
} });
let launchError, browser, page;
child.on('error', error => { launchError = error; });
const result = { exe, model, profile, hostPid: child.pid, cases: [], errors: [], console: [] };
const save = () => writeFile(join(dir, 'report.json'), JSON.stringify(result, null, 2));
async function check(name, fn) {
  try { const evidence = await fn(); result.cases.push({ name, ok: true, evidence }); }
  catch (error) {
    result.cases.push({ name, ok: false, failure: error.stack || String(error) });
    await page.screenshot({ path: join(dir, `failure-${result.cases.length}.png`) }).catch(console.error);
  }
  console.log(name, result.cases.at(-1).ok ? 'PASS' : result.cases.at(-1).failure);
  await save();
}
try {
  const endpoint = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 120; n++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Host exited ${child.exitCode}`);
    try { if ((await fetch(`${endpoint}/json/version`)).ok) break; }
    catch (error) { if (n === 119) throw error; }
    await new Promise(yes => setTimeout(yes, 500));
  }
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts().flatMap(context => context.pages())[0]; assert.ok(page);
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => result.errors.push(error.stack || error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) result.console.push(message.text()); });
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__, null, { timeout: 60000 });
  const sleep = ms => page.waitForTimeout(ms);
  const state = fn => page.evaluate(fn);
  const open = async id => { await page.evaluate(id => globalThis.__ifc_lite_viewer_store__.getState().showWorkspacePanel(id), id); await sleep(420); };
  const box = () => page.locator('canvas[data-viewport="main"]').boundingBox();
  const pose = () => state(() => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint());
  const collapse = () => state(() => globalThis.__ifc_lite_viewer_store__.getState().setSidebarMode('collapsed'));
  const panel = page.locator('.viewer-sidebar-surface');
  const body = page.getByRole('region', { name: 'Colorizer', exact: true });
  const ready = () => body.getByRole('button', { name: 'Paint whole model gray', exact: true }).waitFor({ state: 'visible', timeout: 120000 })
    .then(() => page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === 'Paint whole model gray'); return b && !b.disabled; }, null, { timeout: 120000 }));
  const layer = () => state(() => [...(globalThis.__ifc_lite_viewer_store__.getState().overlayLayers.get('colorizer-preview')?.colorOverrides ?? [])]);
  const order = await state(() => globalThis.__ifc_lite_viewer_store__.getState().sidebarOrder);
  const bottom = ['script','gantt','lists','charts','flow','document','drawing','presentation'];
  const sides = order.filter(id => id !== 'hierarchy' && !bottom.includes(id));
  result.registry = { sides, bottom };
  await check('Info shows the complete source package catalogue and exact versions', async () => {
    const expected = {};
    for (const name of await readdir(join(root, 'packages'))) {
      const manifest = join(root, 'packages', name, 'package.json');
      const pkg = JSON.parse(await readFile(manifest, 'utf8'));
      expected[pkg.name.replace('@ifc-lite/', '')] = pkg.version;
    }
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'About', exact: true }).click();
    await dialog.getByRole('button', { name: `${Object.keys(expected).length} packages`, exact: true }).click();
    const actual = await dialog.locator('span.tabular-nums').evaluateAll(versions => Object.fromEntries(
      versions.map(version => [version.previousElementSibling.textContent.trim(), version.textContent.trim()])));
    assert.deepEqual(actual, expected);
    await page.screenshot({ path: join(dir, 'package-info.png') });
    await page.keyboard.press('Escape');
    return { count: Object.keys(actual).length, versions: actual };
  });
  await check('all side panels render with no loaded model', async () => {
    const records = [];
    for (const id of sides) {
      await open(id);
      const text = await panel.innerText(); assert.ok(text.trim(), `${id}: empty body`);
      assert.ok(!text.includes('Something went wrong'), `${id}: error boundary`);
      records.push({ id, text: text.slice(0, 100) });
    }
    return records;
  });
  await collapse();
  await page.locator('#file-input-open').setInputFiles(model);
  await page.waitForFunction(() => { const s = globalThis.__ifc_lite_viewer_store__.getState(); return !s.loading && s.models.size === 1 && [...s.models.values()][0].geometryResult?.meshes.length > 0; }, null, { timeout: 180000 });
  await sleep(1000);
  result.loaded = await state(() => { const m = [...globalThis.__ifc_lite_viewer_store__.getState().models.values()][0]; return { id: m.id, vertices: m.geometryResult.totalVertices, triangles: m.geometryResult.totalTriangles }; });
  await check('all side panels toggle without opening Properties or moving the camera', async () => {
    const records = []; const original = await box(); const camera = await pose();
    for (const id of sides) {
      await open(id);
      const current = await state(() => { const s = globalThis.__ifc_lite_viewer_store__.getState(); return { id: s.sidebarActivePanel, mode: s.sidebarMode }; });
      assert.deepEqual(current, { id, mode: 'expanded' });
      assert.deepEqual(await box(), original, `${id}: canvas moved`);
      await page.evaluate(id => globalThis.__ifc_lite_viewer_store__.getState().toggleWorkspacePanel(id), id); await sleep(280);
      assert.equal(await state(() => globalThis.__ifc_lite_viewer_store__.getState().sidebarMode), 'collapsed', `${id}: did not close`);
      assert.deepEqual(await pose(), camera, `${id}: camera changed`);
      records.push(id);
    }
    return records;
  });
  await check('bottom panels render, switch and close on the fixed 3D surface', async () => {
    const original = await box(); const records = [];
    for (const id of bottom) {
      await page.evaluate(id => globalThis.__ifc_lite_viewer_store__.getState().toggleBottomPanel(id), id); await sleep(550);
      const strip = page.locator('[data-bottom-strip][data-state="open"]');
      assert.equal(await strip.count(), 1, `${id}: open strip`);
      assert.ok((await strip.innerText()).trim(), `${id}: empty strip`);
      assert.deepEqual(await box(), original, `${id}: bottom panel resized camera`);
      await page.evaluate(id => globalThis.__ifc_lite_viewer_store__.getState().toggleBottomPanel(id), id); await sleep(300);
      assert.equal(await page.locator('[data-bottom-strip][data-state="open"]').count(), 0);
      records.push(id);
    }
    return records;
  });
  await check('rapid side switches settle on the last requested panel', async () => {
    for (let n = 0; n < 3; n++) for (const id of ['sources','placement','properties','measurements','clash']) {
      await page.evaluate(id => globalThis.__ifc_lite_viewer_store__.getState().toggleWorkspacePanel(id), id); await sleep(20);
    }
    await sleep(500);
    const current = await state(() => { const s = globalThis.__ifc_lite_viewer_store__.getState(); return { id: s.sidebarActivePanel, mode: s.sidebarMode }; });
    assert.deepEqual(current, { id: 'clash', mode: 'expanded' }); return current;
  });
  await check('Measurements List releases its latch and closes only its split half', async () => {
    await state(() => globalThis.__ifc_lite_viewer_store__.getState().setActiveTool('measure'));
    await open('measurements');
    const list = page.locator('button[title="Show or hide the Measurements panel"]');
    assert.equal(await list.getAttribute('aria-pressed'), 'true');
    await list.click(); await sleep(300);
    assert.equal(await list.getAttribute('aria-pressed'), 'false', 'closed readout is still latched');
    await open('loadReport');
    await state(() => globalThis.__ifc_lite_viewer_store__.getState().setSidebarSecondaryPanel('measurements')); await sleep(350);
    await list.click(); await sleep(350);
    const next = await state(() => { const s = globalThis.__ifc_lite_viewer_store__.getState(); return { primary: s.sidebarActivePanel, secondary: s.sidebarSecondaryPanel }; });
    assert.deepEqual(next, { primary: 'loadReport', secondary: null });
  });
  await state(() => { const s = globalThis.__ifc_lite_viewer_store__.getState(); s.setSidebarSecondaryPanel(null); s.setActiveTool('select'); });
  await check('docking Drawing beside the scene keeps the same live 3D canvas', async () => {
    await collapse(); await sleep(300);
    const canvas = await page.locator('canvas[data-viewport="main"]').elementHandle();
    const originalView = await pose();
    await state(() => globalThis.__ifc_lite_viewer_store__.getState().toggleBottomPanel('drawing')); await sleep(500);
    try {
      await page.getByRole('button', { name: /Dock.*beside/i }).click(); await sleep(1000);
      assert.equal(await canvas.evaluate(el => el.isConnected), true, 'moving Drawing recreated the 3D renderer');
      await page.getByRole('button', { name: /Dock.*below/i }).click(); await sleep(700);
      assert.equal(await canvas.evaluate(el => el.isConnected), true);
      assert.deepEqual(await pose(), originalView, 're-docking changed the saved camera pose');
    } finally {
      const below = page.getByRole('button', { name: /Dock.*below/i });
      if (await below.count()) await below.click();
      await state(() => globalThis.__ifc_lite_viewer_store__.getState().toggleBottomPanel('drawing')); await sleep(400);
      await page.evaluate(view => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.applyViewpoint(view, false), originalView);
    }
  });
  await check('real mouse gestures reach the 3D canvas after dock transitions', async () => {
    await collapse(); await sleep(400); const canvas = await box(), before = await pose();
    await page.locator('[data-quick-tool="model"]').click();
    await page.mouse.move(canvas.x + canvas.width * .45, canvas.y + canvas.height * .45);
    await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * .45 + 100, canvas.y + canvas.height * .45 + 35, { steps: 12 }); await page.mouse.up(); await sleep(400);
    assert.notDeepEqual(await pose(), before, 'visible canvas is blocked by an overlay');
    await state(() => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.fitAll()); await sleep(900);
  });
  await check('opaque panel pixels remain fixed over camera motion in every theme', async () => {
    const originalTheme = await state(() => globalThis.__ifc_lite_viewer_store__.getState().theme);
    const originalView = await pose(); const samples = [];
    try {
      for (const theme of ['light', 'dark', 'colorful']) {
        await page.evaluate(theme => globalThis.__ifc_lite_viewer_store__.setState({ theme }), theme);
        await open('sources');
        const b = await panel.boundingBox();
        const clip = { x: Math.ceil(b.x + 10), y: Math.ceil(b.y + b.height * .74), width: Math.floor(b.width - 20), height: Math.floor(b.height * .2) };
        const before = await page.screenshot({ path: join(dir, `surface-${theme}-a.png`), clip });
        await state(() => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.orbit(180, 0)); await sleep(1000);
        const after = await page.screenshot({ path: join(dir, `surface-${theme}-b.png`), clip });
        assert.equal(before.equals(after), true, `${theme}: scene motion leaked through the panel`);
        samples.push({ theme, width: clip.width, height: clip.height, identicalPng: true });
      }
    } finally {
      await page.evaluate(({ theme, view }) => { const s = globalThis.__ifc_lite_viewer_store__.getState(); globalThis.__ifc_lite_viewer_store__.setState({ theme }); s.cameraCallbacks.applyViewpoint(view, false); }, { theme: originalTheme, view: originalView });
    }
    return samples;
  });
  await check('Colorizer draft survives switching to Properties and returning', async () => {
    await open('colorizer'); await ready();
    await body.getByRole('button', { name: 'Paint whole model gray', exact: true }).click(); await sleep(150);
    const before = await layer(); assert.ok(before.length > 0);
    await open('properties'); const whileHidden = await layer();
    await open('colorizer'); await ready(); const after = await layer();
    result.draftLifetime = { before: before.length, whileHidden: whileHidden.length, after: after.length };
    assert.equal(JSON.stringify(after) === JSON.stringify(before), true, 'switching tabs silently discarded the unsaved paint');
    assert.equal(await body.getByRole('button', { name: 'Undo', exact: true }).isEnabled(), true);
    return result.draftLifetime;
  });
  await check('Colorizer draft survives a dock split and rejoin', async () => {
    await open('colorizer'); await ready();
    await body.getByRole('button', { name: 'Paint whole model gray', exact: true }).click(); await sleep(150);
    const before = await layer();
    await state(() => globalThis.__ifc_lite_viewer_store__.getState().setSidebarSecondaryPanel('properties')); await sleep(450);
    await state(() => globalThis.__ifc_lite_viewer_store__.getState().setSidebarSecondaryPanel(null)); await ready();
    assert.equal(JSON.stringify(await layer()) === JSON.stringify(before), true, 'split remount discarded the draft'); return { products: before.length };
  });
  await check('Colorizer select-group checkboxes and 3D selection stay consistent', async () => {
    await open('colorizer'); await ready(); const group = body.getByRole('checkbox').first();
    await group.check();
    const count = await state(() => globalThis.__ifc_lite_viewer_store__.getState().selectedEntityIds.size); assert.ok(count > 0);
    await state(() => globalThis.__ifc_lite_viewer_store__.getState().clearSelection()); await sleep(100);
    assert.equal(await group.isChecked(), false, 'group stays checked after clearing its 3D selection'); return { selected: count };
  });
  await check('adding and removing a federated model preserves the existing source draft', async () => {
    await open('colorizer'); await ready();
    await body.getByRole('button', { name: 'Paint whole model gray', exact: true }).click(); await sleep(100);
    const before = await layer();
    const owner = await state(() => globalThis.__ifc_lite_viewer_store__.getState().activeModelId);
    const source = await readFile(model), header = source.indexOf(Buffer.from('HEADER;')) + 7;
    assert.ok(header >= 7, 'the audit fixture must be STEP IFC');
    // A distinct real source with identical geometry, leaving the input untouched.
    const twin = Buffer.concat([source.subarray(0, header), Buffer.from('\n/* independent federation audit source */\n'), source.subarray(header)]);
    await page.locator('#file-input-add').setInputFiles({ name: 'audit-second.ifc', mimeType: 'application/octet-stream', buffer: twin });
    await page.waitForFunction(() => { const s = globalThis.__ifc_lite_viewer_store__.getState(); return !s.loading && s.models.size === 2; }, null, { timeout: 180000 });
    let selectedProducts;
    try {
      await ready(); assert.equal(JSON.stringify(await layer()) === JSON.stringify(before), true, 'a federated load discarded existing paint');
      const group = body.getByRole('checkbox').first(); await group.check();
      const refs = await state(() => { const s = globalThis.__ifc_lite_viewer_store__.getState(); return [...s.selectedEntityIds].map(id => s.resolveGlobalIdFromModels(id)); });
      assert.ok(refs.length > 0); assert.ok(refs.every(ref => ref?.modelId === owner), 'selected ids must resolve to the draft owner');
      selectedProducts = refs.length;
    } finally {
      await page.evaluate(owner => { const s = globalThis.__ifc_lite_viewer_store__.getState(); for (const id of s.models.keys()) if (id !== owner) s.removeModel(id); }, owner);
    }
    await sleep(500); assert.equal(JSON.stringify(await layer()) === JSON.stringify(before), true);
    return { paintedProducts: before.length, selectedProducts, resolvedOwner: owner };
  });
  await check('Save as completes with the same draft when switching away during export', async () => {
    await open('colorizer'); await ready();
    await body.getByRole('button', { name: 'Paint whole model gray', exact: true }).click(); await sleep(100);
    const downloadReady = page.waitForEvent('download', { timeout: 30000 }).then(download => ({ download }), error => ({ error }));
    await body.getByRole('button', { name: 'Save as', exact: true }).click();
    const busyWhenLeaving = await body.getAttribute('aria-busy');
    await open('properties');
    const received = await downloadReady;
    if (received.error) throw received.error;
    const download = received.download; assert.equal(await download.failure(), null);
    const path = join(dir, 'audit-gray.ifc'); await download.saveAs(path);
    const bytes = await readFile(path);
    assert.ok(bytes.subarray(0, 500).includes(Buffer.from('ISO-10303-21;')), 'the saved file is STEP IFC');
    assert.ok(bytes.subarray(-500).includes(Buffer.from('END-ISO-10303-21;')), 'the export is complete');
    await open('colorizer'); await ready();
    return { bytes: bytes.length, suggestedFilename: download.suggestedFilename(), busyWhenLeaving };
  });
  await check('closing all models clears preview and pending source sessions', async () => {
    await open('colorizer'); await ready();
    await state(() => globalThis.__ifc_lite_viewer_store__.getState().clearAllModels()); await sleep(700);
    assert.equal(await state(() => globalThis.__ifc_lite_viewer_store__.getState().models.size), 0);
    assert.equal((await layer()).length, 0);
    assert.equal(await body.getByRole('button', { name: 'Save as', exact: true }).isEnabled(), false);
  });
  result.ok = result.cases.every(c => c.ok) && result.errors.length === 0;
} catch (error) { result.failure = error.stack || String(error); process.exitCode = 1; }
finally {
  try { await save(); }
  finally {
    try { if (browser) await browser.close(); }
    finally { if (child.exitCode === null) child.kill(); }
  }
}
console.log(JSON.stringify({ ok: result.ok, failed: result.cases.filter(c => !c.ok).map(c => c.name), errors: result.errors, failure: result.failure }, null, 2));
if (!result.ok) process.exitCode = 1;
