// Acceptance for the simplified native Colorizer and quiet desktop launch.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const ribbonOnly = process.env.RIBBON_ONLY === '1';
const dir = resolve(import.meta.dirname, ribbonOnly ? 'native-ribbon-stress' : 'native-ux');
await mkdir(dir, { recursive: true });
const exe = resolve(root, process.env.SMOKE_EXE || 'desktop/release/10.3.0-native-colorizer-ux-20261016-r2/IFC-Lite.exe');
const model = 'F:/Steel/VBA/IFC COLO/hangarvd_f10_ tan base_f01_colored.ifc';
const listener = createServer();
await new Promise(yes => listener.listen(0, '127.0.0.1', yes));
const port = listener.address().port;
await new Promise(yes => listener.close(yes));
const profile = await mkdtemp(join(tmpdir(), 'ifclite-colorizer-ux-'));
const child = spawn(exe, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
  WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run`,
} });
let launchError, browser, page;
child.on('error', error => { launchError = error; });
const result = { exe, model, profile, assertions: [], errors: [], warnings: [] };
const passed = (name, evidence) => { result.assertions.push({ name, evidence }); console.log(name, evidence ?? ''); };
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
  page.on('pageerror', error => result.errors.push(error.stack || error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) result.warnings.push(message.text()); });
  await page.waitForFunction(() => !!globalThis.__ifc_lite_viewer_store__ && !!globalThis.__IFCLITE_COLORIZER__, null, { timeout: 60000 });
  await page.locator('[data-desktop-start]').waitFor();
  await page.waitForTimeout(4000);
  const initial = await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return { leftCollapsed: s.leftPanelCollapsed, ribbonCollapsed: s.ribbonCollapsed, sidebarMode: s.sidebarMode };
  });
  assert.deepEqual(initial, { leftCollapsed: true, ribbonCollapsed: true, sidebarMode: 'collapsed' });
  assert.equal(await page.getByRole('button', { name: 'Open IFC file', exact: true }).count(), 1);
  assert.equal((await page.locator('body').innerText()).includes('IFClite stores an action log'), false);
  await page.screenshot({ path: join(dir, '01-startup.png') });
  passed('quiet startup: no hierarchy, collapsed ribbon/sidebar, no welcome or privacy toast', initial);
  await page.locator('#file-input-open').setInputFiles(model);
  await page.waitForFunction(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return !s.loading && s.models.size === 1 && [...s.models.values()][0].geometryResult?.meshes.length > 0;
  }, null, { timeout: 180000 });
  const before = await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState(); const m = [...s.models.values()][0];
    return { edit: s.editEnabled, storeys: s.levelDisplayMode, sourceBytes: m.ifcDataStore.source.byteLength,
      vertices: m.geometryResult.totalVertices, triangles: m.geometryResult.totalTriangles };
  });
  await page.getByRole('tab', { name: 'Author', exact: true }).click();
  await page.locator('[data-command-id="panel:colorizer"]').click();
  const panel = page.getByRole('region', { name: 'Colorizer', exact: true });
  await panel.getByRole('checkbox', { name: 'Select group PIPE-267.4X8', exact: true }).waitFor({ timeout: 120000 });
  assert.equal(await panel.getByRole('button', { name: 'Prepare model' }).count(), 0);
  assert.equal(await panel.getByLabel('IFC file', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().editEnabled), false);
  passed('opening Colorizer automatically reads groups, with no Model/Edit mode or preparation step');
  await panel.getByRole('button', { name: 'Paint whole model gray', exact: true }).click();
  await panel.getByRole('checkbox', { name: 'Select group PIPE-267.4X8', exact: true }).check();
  await panel.getByRole('button', { name: 'Apply colour (1)', exact: true }).click();
  const paints = () => page.evaluate(() => {
    const colors = globalThis.__ifc_lite_viewer_store__.getState().overlayLayers.get('colorizer-preview')?.colorOverrides;
    const counts = {};
    for (const color of colors?.values() ?? []) { const key = color.join(','); counts[key] = (counts[key] ?? 0) + 1; }
    return counts;
  });
  const expected = { '1,0,0,1': 1968, '0.5019607843137255,0.5019607843137255,0.5019607843137255,1': 12541 };
  assert.deepEqual(await paints(), expected);
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(Object.keys(await paints()).length, 1);
  await panel.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await paints(), expected);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(dir, '02-colorizer.png') });
  // Sample the actual animated height and rAF spacing while clicking the chevron.
  for (const action of ['Collapse the ribbon','Expand the ribbon']) {
    const trace = page.evaluate(() => new Promise(resolve => {
      const frames = []; let start;
      const frame = time => {
        start ??= time;
        frames.push({ time: time - start, height: document.querySelector('.viewer-ribbon-band').getBoundingClientRect().height });
        if (time - start < 650) requestAnimationFrame(frame); else resolve(frames);
      };
      requestAnimationFrame(frame);
    }));
    await page.getByRole('button', { name: action, exact: true }).click();
    const frames = await trace;
    const gaps = frames.slice(1).map((frame,index) => frame.time - frames[index].time).sort((a,b) => a-b);
    const intermediate = frames.filter(frame => frame.height > 0.5 && frame.height < 87.5).length;
    const verdict = { action, intermediateFrames: intermediate, p95FrameGapMs: gaps[Math.floor(gaps.length*.95)], maxFrameGapMs: gaps.at(-1), frames };
    await writeFile(join(dir, `ribbon-${action.split(' ')[0].toLowerCase()}.json`), JSON.stringify(verdict,null,2));
    assert.ok(intermediate >= 4, 'the ribbon traverses intermediate heights instead of jumping');
    assert.ok(verdict.p95FrameGapMs <= 25 && verdict.maxFrameGapMs <= 50, 'loaded-model ribbon animation meets the frame-gap budget');
    passed('loaded-model ribbon animation', { action, intermediateFrames:intermediate, p95FrameGapMs:verdict.p95FrameGapMs,maxFrameGapMs:verdict.maxFrameGapMs });
  }
  await page.emulateMedia({ reducedMotion:'reduce' });
  assert.equal(await page.locator('.viewer-ribbon-band').evaluate(el => getComputedStyle(el).transitionDuration),'0s');
  await page.emulateMedia({ reducedMotion:'no-preference' });
  passed('ribbon respects reduced motion');
  if (ribbonOnly) {
    const trace = page.evaluate(() => new Promise(resolve => {
      const frames=[]; let start;
      const frame=time=>{ start??=time; frames.push({time:time-start,height:document.querySelector('.viewer-ribbon-band').getBoundingClientRect().height});
        if(time-start<850) requestAnimationFrame(frame); else resolve(frames); };
      requestAnimationFrame(frame);
    }));
    for (const action of ['Collapse the ribbon','Expand the ribbon','Collapse the ribbon','Expand the ribbon']) {
      await page.getByRole('button',{name:action,exact:true}).click();
      await page.waitForTimeout(45);
    }
    const frames=await trace;
    const maxHeightStep=Math.max(...frames.slice(1).map((f,i)=>Math.abs(f.height-frames[i].height)));
    const maxFrameGapMs=Math.max(...frames.slice(1).map((f,i)=>f.time-frames[i].time));
    const intermediateFrames=frames.filter(f=>f.height>0.5&&f.height<87.5).length;
    await writeFile(join(dir,'rapid-reversal.json'),JSON.stringify({maxHeightStep,maxFrameGapMs,intermediateFrames,frames},null,2));
    assert.ok(maxHeightStep<=45&&maxFrameGapMs<=50&&intermediateFrames>=8,'rapid reversals interpolate from the current height without jumps');
    passed('rapid ribbon reversals',{maxHeightStep,maxFrameGapMs,intermediateFrames});
  }
  if (!ribbonOnly) {
  // Repeat activation closes the same dock, preserving the preview while collapsed.
  await page.locator('[data-command-id="panel:colorizer"]').click();
  assert.deepEqual(await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState(); return { panel: s.sidebarActivePanel, mode: s.sidebarMode };
  }), { panel: 'colorizer', mode: 'collapsed' });
  assert.deepEqual(await paints(), expected);
  await page.screenshot({ path: join(dir, '03-closed.png') });
  await page.locator('[data-command-id="panel:colorizer"]').click();
  await panel.getByRole('button', { name: 'Save coloured IFC', exact: true }).waitFor();
  assert.deepEqual(await paints(), expected);
  passed('second click collapses Colorizer without Properties; third click restores the draft');
  // Switching grouping is automatic and keeps the draft.
  await panel.getByRole('combobox').selectOption('class');
  await panel.getByRole('checkbox', { name: 'Select group IfcColumn', exact: true }).waitFor({ timeout: 120000 });
  assert.deepEqual(await paints(), expected);
  passed('grouping updates automatically without a Regroup button');
  await page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith('_colored.ifc')) globalThis.__colorizerDownload = fetch(this.href).then(r => r.arrayBuffer());
      else original.call(this);
    };
  });
  await panel.getByRole('button', { name: 'Save coloured IFC', exact: true }).click();
  await panel.getByText('Coloured IFC exported.', { exact: true }).waitFor({ timeout: 120000 });
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await globalThis.__colorizerDownload)));
  const output = join(dir, 'ui-gray-red.ifc'); await writeFile(output, new Uint8Array(bytes));
  passed('save from ordinary view mode creates a full IFC', { output, bytes: bytes.length });
  assert.equal(await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().editEnabled), false);
  await page.locator('#file-input-open').setInputFiles(output);
  await page.waitForFunction(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return !s.loading && [...s.models.values()].some(m => m.name === 'ui-gray-red.ifc' && m.geometryResult?.meshes.length > 0);
  }, null, { timeout: 180000 });
  const after = await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState(); const m = [...s.models.values()].find(m => m.name === 'ui-gray-red.ifc');
    return { vertices: m.geometryResult.totalVertices, triangles: m.geometryResult.totalTriangles };
  });
  assert.equal(after.vertices, before.vertices); assert.equal(after.triangles, before.triangles);
  passed('saved IFC reopens in native with equal geometry totals', after);
  // Pick five independent members using real Ctrl+clicks on projected geometry.
  await panel.getByRole('button', { name:'Paint whole model gray', exact:true }).click();
  const canvas = page.locator('canvas[data-viewport="main"]');
  const canvasBox = await canvas.boundingBox(); assert.ok(canvasBox);
  const targets = await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState(); const m = [...s.models.values()][0];
    const points = [], cells = new Set();
    for (let n=0;n<m.geometryResult.meshes.length;n+=7) {
      const mesh = m.geometryResult.meshes[n], p = mesh.positions, indices = mesh.indices;
      if (indices.length < 3) continue;
      const center = [0,0,0];
      for (const vertex of Array.from(indices.slice(0,3))) for (let axis=0;axis<3;axis++) center[axis] += p[vertex*3+axis]/3;
      const origin = mesh.origin ?? [0,0,0];
      const screen = s.cameraCallbacks.projectToScreen?.({x:center[0]+origin[0],y:center[1]+origin[1],z:center[2]+origin[2]});
      if (!screen || !Number.isFinite(screen.x+screen.y)) continue;
      const key = `${Math.round(screen.x/5)},${Math.round(screen.y/5)}`;
      if (cells.has(key)) continue;
      cells.add(key); points.push(screen);
    }
    return points;
  });
  if (await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().selectedEntityIds.size)) await page.keyboard.press('Escape');
  await page.keyboard.down('Control');
  const gestures = [];
  try {
    for (const point of targets) {
      if (point.x < 80 || point.y < 80 || point.x > canvasBox.width-100 || point.y > canvasBox.height-70) continue;
      await page.mouse.click(canvasBox.x+point.x,canvasBox.y+point.y);
      const ids = await page.evaluate(() => [...globalThis.__ifc_lite_viewer_store__.getState().selectedEntityIds]);
      gestures.push({ point, ids });
      if (ids.length === 5) break;
      if (gestures.length >= 80) break;
    }
  } finally { await page.keyboard.up('Control'); }
  const picked = await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return [...s.selectedEntityIds].map(globalId => ({globalId,ref:s.resolveGlobalIdFromModels(globalId)}));
  });
  await writeFile(join(dir,'selection-gestures.json'),JSON.stringify({targets:targets.length,canvasBox,gestures,picked},null,2));
  assert.equal(picked.length,5,'five distinct members selected by mouse gestures');
  assert.ok(picked.every(row => row.ref));
  await writeFile(join(dir,'selected-ids.json'),JSON.stringify(picked.map(row=>row.ref.expressId)));
  await panel.getByRole('button',{ name:'Paint 3D selection',exact:true }).click();
  assert.deepEqual(await paints(), { '1,0,0,1':5, '0.5019607843137255,0.5019607843137255,0.5019607843137255,1':14504 });
  await page.keyboard.press('Escape');
  await page.screenshot({path:join(dir,'04-five-selected.png')});
  await panel.getByRole('button',{name:'Save coloured IFC',exact:true}).click();
  await panel.getByText('Coloured IFC exported.',{exact:true}).waitFor({timeout:120000});
  const fiveBytes = await page.evaluate(async()=>Array.from(new Uint8Array(await globalThis.__colorizerDownload)));
  await writeFile(join(dir,'ui-five-selected.ifc'),new Uint8Array(fiveBytes));
  passed('five noncontiguous members picked by Ctrl+click are painted and saved separately',{picked,gestures:gestures.length,bytes:fiveBytes.length});
  }
  assert.equal(result.errors.length, 0); result.ok = true;
} catch (error) {
  result.failure = error.stack || String(error); process.exitCode = 1;
  if (page) { result.body = await page.locator('body').innerText().catch(String); await page.screenshot({ path: join(dir, 'failure.png') }).catch(String); }
} finally {
  await writeFile(join(dir, 'report.json'), JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  if (child.exitCode === null) child.kill();
}
console.log(JSON.stringify({ ok: result.ok, failure: result.failure }, null, 2));
