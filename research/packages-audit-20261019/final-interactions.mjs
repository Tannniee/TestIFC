// Acceptance for the simplified native Colorizer and quiet desktop launch.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const ribbonOnly = false;
const dir = resolve(import.meta.dirname, process.env.EVIDENCE_DIR || 'native-interactions-r2');
await mkdir(dir, { recursive: true });
const exe = resolve(root, process.env.SMOKE_EXE || 'desktop/release/10.3.0-native-interactions-20261016-r2/IFC-Lite.exe');
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

  await page.waitForTimeout(1500);
  const rail = page.locator('[data-activity-bar]');
  const canvas = page.locator('canvas[data-viewport="main"]');
  const sample = () => page.evaluate(() => {
    const s=globalThis.__ifc_lite_viewer_store__.getState(), canvas=document.querySelector('canvas[data-viewport="main"]');
    const r=canvas.getBoundingClientRect(), m=[...s.models.values()][0], b=m.geometryResult.coordinateInfo.shiftedBounds;
    const worlds=[b.min,b.max,{x:(b.min.x+b.max.x)/2,y:(b.min.y+b.max.y)/2,z:(b.min.z+b.max.z)/2}];
    return {rect:{x:r.x,y:r.y,width:r.width,height:r.height}, pose:s.cameraCallbacks.getViewpoint(), points:worlds.map(p=>{
      const q=s.cameraCallbacks.projectToScreen(p);return q?{x:q.x+r.x,y:q.y+r.y}:null;
    })};
  });
  const stationary = async (name, action, motionSelector, dimension) => {
    const baseline = await sample();
    const trace = page.evaluate(({motionSelector,dimension})=>new Promise(resolve=>{
      const frames=[];let start;
      const loop=time=>{
        start??=time;const s=globalThis.__ifc_lite_viewer_store__.getState(),c=document.querySelector('canvas[data-viewport="main"]'),r=c.getBoundingClientRect();
        const m=[...s.models.values()][0],b=m.geometryResult.coordinateInfo.shiftedBounds;
        const worlds=[b.min,b.max,{x:(b.min.x+b.max.x)/2,y:(b.min.y+b.max.y)/2,z:(b.min.z+b.max.z)/2}];
        const el=document.querySelector(motionSelector),box=el?.getBoundingClientRect();
        frames.push({time:time-start,rect:{x:r.x,y:r.y,width:r.width,height:r.height},dimension:box?.[dimension],points:worlds.map(p=>{
          const q=s.cameraCallbacks.projectToScreen(p);return q?{x:q.x+r.x,y:q.y+r.y}:null;
        })});
        if(time-start<600)requestAnimationFrame(loop);else resolve(frames);
      };requestAnimationFrame(loop);
    }),{motionSelector,dimension});
    await action();const frames=await trace;
    let drift=0;
    for(const f of frames){assert.deepEqual(f.rect,baseline.rect,`${name}: canvas bounds`);for(let i=0;i<3;i++)if(f.points[i]&&baseline.points[i]){
      drift=Math.max(drift,Math.hypot(f.points[i].x-baseline.points[i].x,f.points[i].y-baseline.points[i].y));
    }}
    assert.ok(drift<.01,`${name} shifted world points by ${drift}px`);
    const values=frames.map(f=>f.dimension).filter(Number.isFinite),lo=Math.min(...values),hi=Math.max(...values);
    const middle=values.filter(v=>v>lo+.5&&v<hi-.5).length;
    if(hi-lo>2)assert.ok(middle>=3,`${name} must have intermediate animation frames`);
    await writeFile(join(dir,`motion-${result.assertions.length}.json`),JSON.stringify({name,drift,middle,frames},null,2));
    passed(name,{maxWorldPointDriftPx:drift,intermediateFrames:middle});
  };
  if(process.env.SKIP_LAYOUT!=='1'){
  await stationary('ribbon expands without resizing or moving IFC',()=>page.getByRole('button',{name:'Expand the ribbon',exact:true}).click(),'.viewer-ribbon-band','height');
  await stationary('ribbon collapses without resizing or moving IFC',()=>page.getByRole('button',{name:'Collapse the ribbon',exact:true}).click(),'.viewer-ribbon-band','height');
  const home=page.getByRole('tab',{name:'Home',exact:true});
  for(const expected of [false,true,false,true]){
    await home.dblclick();
    assert.equal(await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().ribbonCollapsed),expected);
  }
  passed('one actual double-click toggles ribbon in both directions, four consecutive times');
  await page.waitForTimeout(350);
  await stationary('Hierarchy opens over the stationary IFC view',()=>rail.locator('[data-tour="activity-hierarchy"]').click(),'.viewer-main-split > [data-panel]:first-child','width');
  await stationary('Hierarchy closes over the stationary IFC view',()=>rail.locator('[data-tour="activity-hierarchy"]').click(),'.viewer-main-split > [data-panel]:first-child','width');
  // Use the activity-bar's actual labels, recorded for reproducibility.
  const labels=await rail.getByRole('button').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label')));
  await writeFile(join(dir,'rail-labels.json'),JSON.stringify(labels,null,2));
  for(const title of ['properties','model','appearance','bcf','validation','lens','clash','sources','zones','loadReport','cost','environment','pointclouds','measurements','changes','colorizer']){
    const control=rail.locator(`[data-tour="activity-${title}"]`);
    if(!await control.count()||!await control.isEnabled())continue;
    await stationary(`${title} opens over the stationary IFC view`,()=>control.click(),'.viewer-sidebar-reveal','width');
    const active=await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().sidebarActivePanel);assert.equal(active,title);
    await stationary(`${title} closes without opening Properties`,()=>control.click(),'.viewer-sidebar-reveal','width');
    const state=await page.evaluate(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();return{mode:s.sidebarMode,active:s.sidebarActivePanel};});
    assert.deepEqual(state,{mode:'collapsed',active});
  }
  const entered=await page.evaluate(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();const entered=s.enterModelWorkspace();s.setModelLayout('split');s.setSidebarMode('collapsed');return entered;});
  assert.equal(entered,true);await page.locator('[data-model-layout="split"]').waitFor();await page.waitForTimeout(800);
  await stationary('Plan/3D: Hierarchy opens without resizing the 3D pane',()=>rail.locator('[data-tour="activity-hierarchy"]').click(),'.viewer-main-split > [data-panel]:first-child','width');
  await stationary('Plan/3D: Hierarchy closes without moving IFC',()=>rail.locator('[data-tour="activity-hierarchy"]').click(),'.viewer-main-split > [data-panel]:first-child','width');
  await stationary('Plan/3D: Properties opens without resizing the 3D pane',()=>rail.locator('[data-tour="activity-properties"]').click(),'.viewer-sidebar-reveal','width');
  await stationary('Plan/3D: Properties closes without moving IFC',()=>rail.locator('[data-tour="activity-properties"]').click(),'.viewer-sidebar-reveal','width');
  await stationary('Plan/3D: ribbon expands without moving IFC',()=>page.getByRole('button',{name:'Expand the ribbon',exact:true}).click(),'.viewer-ribbon-band','height');
  await stationary('Plan/3D: ribbon collapses without moving IFC',()=>page.getByRole('button',{name:'Collapse the ribbon',exact:true}).click(),'.viewer-ribbon-band','height');
  await page.screenshot({path:join(dir,'01-plan-3d.png')});
  await page.evaluate(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();s.exitModelWorkspace();s.setSidebarMode('collapsed');});await page.waitForTimeout(800);
  const lists=rail.locator('[data-tour="activity-lists"]');
  await stationary('bottom panel opens without moving IFC',()=>lists.click(),'[data-bottom-strip]','height');
  await stationary('bottom panel closes without moving IFC',()=>lists.click(),'[data-bottom-strip]','height');
  }
  await rail.locator('[data-tour="activity-colorizer"]').click();
  const panel=page.getByRole('region',{name:'Colorizer',exact:true});
  await panel.getByRole('checkbox',{name:'Select group PIPE-267.4X8',exact:true}).waitFor({timeout:120000});
  await page.waitForTimeout(350);
  assert.equal(await panel.getByText('Choose colours and save a new IFC.',{exact:true}).count(),0);
  assert.equal(await panel.getByLabel('Transparency (%)',{exact:true}).isVisible(),true);
  const saveBox=await panel.getByRole('button',{name:'Save as',exact:true}).boundingBox();
  const panelBox=await panel.boundingBox();assert.ok(saveBox.width<panelBox.width*.6&&saveBox.x>panelBox.x+panelBox.width*.4);
  await panel.getByRole('button',{name:'Paint whole model gray',exact:true}).click();
  await panel.getByRole('checkbox',{name:'Select group PIPE-267.4X8',exact:true}).check();
  const groupIds=await page.evaluate(()=>[...globalThis.__ifc_lite_viewer_store__.getState().selectedEntityIds]);
  assert.equal(groupIds.length,1968);
  await page.screenshot({path:join(dir,'02-group-highlight.png')});
  passed('group checkbox drives 3D selection highlight; compact Save as and visible transparency',{selected:groupIds.length,saveBox,panelBox});
  const grouping=panel.locator('select').first();
  const sameLayer=await page.evaluate(()=>{globalThis.__paintLayer=globalThis.__ifc_lite_viewer_store__.getState().overlayLayers.get('colorizer-preview');return true;});
  for(const mode of ['class','material','storey','section']){
    await grouping.selectOption(mode);await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>globalThis.__paintLayer===globalThis.__ifc_lite_viewer_store__.getState().overlayLayers.get('colorizer-preview')),true);
  }
  passed('changing all grouping modes retains the identical preview layer without repeated colour uploads');
  // PAN must preserve the current camera after selecting another navigation mode.
  for(const mode of ['selection','model','multi','model']){
    const pose=(await sample()).pose;
    await page.locator(`[data-quick-tool="${mode}"]`).click();await page.waitForTimeout(650);
    assert.deepEqual((await sample()).pose,pose,`${mode} must not move the camera`);
  }
  passed('orbit selection / multi-selection / PAN preserve camera pose');
  // Pick five different members using actual Ctrl+clicks, then colour via right-click.
  await page.keyboard.press('Escape');
  const targets=await page.evaluate(()=>{
    const s=globalThis.__ifc_lite_viewer_store__.getState(),m=[...s.models.values()][0],points=[],cells=new Set();
    for(let n=0;n<m.geometryResult.meshes.length;n+=7){const mesh=m.geometryResult.meshes[n],p=mesh.positions,indices=mesh.indices;if(indices.length<3)continue;
      const center=[0,0,0];for(const vertex of Array.from(indices.slice(0,3)))for(let axis=0;axis<3;axis++)center[axis]+=p[vertex*3+axis]/3;
      const o=mesh.origin??[0,0,0],q=s.cameraCallbacks.projectToScreen({x:center[0]+o[0],y:center[1]+o[1],z:center[2]+o[2]});
      if(!q||!Number.isFinite(q.x+q.y))continue;const key=`${Math.round(q.x/5)},${Math.round(q.y/5)}`;if(cells.has(key))continue;cells.add(key);points.push(q);
    }return points;
  });
  const box=await canvas.boundingBox(),gestures=[];await page.keyboard.down('Control');
  try{for(const point of targets){if(point.x<90||point.y<150||point.x>box.width-panelBox.width-100||point.y>box.height-70)continue;
    await page.mouse.click(box.x+point.x,box.y+point.y);const ids=await page.evaluate(()=>[...globalThis.__ifc_lite_viewer_store__.getState().selectedEntityIds]);
    gestures.push({point,ids});if(ids.length===5)break;if(gestures.length>100)break;
  }}finally{await page.keyboard.up('Control');}
  const picked=await page.evaluate(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();return[...s.selectedEntityIds].map(id=>s.resolveGlobalIdFromModels(id)?.expressId);});
  assert.equal(picked.length,5);await writeFile(join(dir,'selected-ids.json'),JSON.stringify(picked));
  await writeFile(join(dir,'selection-gestures.json'),JSON.stringify(gestures,null,2));
  const last=gestures.at(-1).point;await page.mouse.click(box.x+last.x,box.y+last.y,{button:'right'});
  // Explicit real click opens the Radix submenu without a hover timing dependency.
  await page.getByRole('menuitem',{name:'Colour selection',exact:true}).click();
  await page.getByRole('menuitem',{name:'#ff0000',exact:true}).waitFor({state:'visible'});
  await page.screenshot({path:join(dir,'03-quick-menu.png')});
  await page.getByRole('menuitem',{name:'#ff0000',exact:true}).click();
  await page.waitForFunction(()=>{
    const c=globalThis.__ifc_lite_viewer_store__.getState().overlayLayers.get('colorizer-preview')?.colorOverrides;
    return c&&[...c.values()].filter(v=>v[0]===1&&v[1]===0&&v[2]===0).length===5;
  });
  await page.screenshot({path:join(dir,'03-quick-five.png')});
  await page.evaluate(()=>{
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download){globalThis.__downloadName=this.download;globalThis.__downloadBlob=fetch(this.href).then(r=>r.blob());}else click.call(this);};
  });
  await panel.getByRole('button',{name:'Save as',exact:true}).click();
  await page.waitForFunction(()=>!!globalThis.__downloadBlob,null,{timeout:120000});
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await(await globalThis.__downloadBlob).arrayBuffer())));
  await writeFile(join(dir,'ui-five-selected.ifc'),new Uint8Array(bytes));
  passed('right-click quick colour paints the five picked objects and exports the same draft',{picked,bytes:bytes.length});
  await page.keyboard.press('Escape');await page.screenshot({path:join(dir,'03-painted-five.png')});
  await panel.getByRole('button',{name:'Undo',exact:true}).click();
  assert.equal(await page.evaluate(()=>[...globalThis.__ifc_lite_viewer_store__.getState().overlayLayers.get('colorizer-preview').colorOverrides.values()].filter(v=>v[0]===1).length),0);
  passed('quick-colour shares Colorizer undo');
  // Leaving a live Top box-draw must restore orientation and scale through intermediate frames.
  await rail.locator('[data-tour="activity-colorizer"]').click();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().setActiveTool('section'));
  const section=page.locator('[data-tool-bar="section"]');await section.getByRole('radio',{name:'Box',exact:true}).click();
  await page.waitForTimeout(1600);
  const trace=page.evaluate(()=>new Promise(resolve=>{const frames=[];let start;const loop=t=>{start??=t;frames.push({time:t-start,pose:globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint()});if(t-start<1300)requestAnimationFrame(loop);else resolve(frames);};requestAnimationFrame(loop);}));
  await section.getByRole('radio',{name:'Front',exact:true}).click();const frames=await trace;
  await writeFile(join(dir,'box-plane-transition.json'),JSON.stringify(frames,null,2));
  const distinct=new Set(frames.map(f=>JSON.stringify(f.pose))).size;assert.ok(distinct>5,'box-to-plane transition has intermediate camera poses');
  passed('Box to plane restores camera smoothly',{distinctCameraPoses:distinct});
  await page.screenshot({path:join(dir,'04-section.png')});
  await page.locator('#file-input-open').setInputFiles(join(dir,'ui-five-selected.ifc'));
  await page.waitForFunction(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();return!s.loading&&[...s.models.values()].some(m=>m.name==='ui-five-selected.ifc'&&m.geometryResult?.meshes.length);},null,{timeout:180000});
  const reopened=await page.evaluate(()=>{const m=[...globalThis.__ifc_lite_viewer_store__.getState().models.values()].find(m=>m.name==='ui-five-selected.ifc');return{vertices:m.geometryResult.totalVertices,triangles:m.geometryResult.totalTriangles};});
  assert.equal(reopened.vertices,before.vertices);assert.equal(reopened.triangles,before.triangles);
  passed('saved quick-colour IFC reopens in native with identical geometry totals',reopened);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter(w => String(w).includes('[UnitExtractor]')).length, 0,
    'native cached units avoid false released-source warnings during real editing');
  passed('native editing retains declared length units after STEP source release');
  result.ok = true;
} catch (error) {
  result.failure = error.stack || String(error); process.exitCode = 1;
  if (page) { result.body = await page.locator('body').innerText().catch(String); await page.screenshot({ path: join(dir, 'failure.png') }).catch(String); }
} finally {
  await writeFile(join(dir, 'report.json'), JSON.stringify(result, null, 2));
  if (browser) await browser.close();
  if (child.exitCode === null) child.kill();
}
console.log(JSON.stringify({ ok: result.ok, failure: result.failure }, null, 2));
