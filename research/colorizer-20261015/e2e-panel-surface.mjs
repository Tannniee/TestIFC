// Packaged acceptance for opaque sidebar surfaces and shared clash navigation.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const ribbonOnly = false;
const dir = resolve(import.meta.dirname, process.env.EVIDENCE_DIR || 'native-panel-surface');
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



  const baseline=process.env.BASELINE==='1';
  await page.evaluate(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();if(s.theme==='light')s.toggleTheme();});
  await page.mouse.move(80,900);
  const sample=(id,subtab=false)=>page.evaluate(({id,subtab})=>new Promise(resolve=>{
    const frames=[];let start;
    const loop=t=>{start??=t;const surface=document.querySelector('.viewer-sidebar-reveal > .panel-container');
      const content=subtab?surface.querySelector('.viewer-tab-content[data-state="active"]'):(surface.querySelector(`[data-sidebar-panel="${id}"]`) || surface.querySelector('.viewer-panel-enter'));
      const root=getComputedStyle(surface),style=content?getComputedStyle(content):null,c=document.querySelector('canvas[data-viewport="main"]').getBoundingClientRect();
      frames.push({time:t-start,background:root.backgroundColor,surfaceOpacity:Number(root.opacity),contentOpacity:style?Number(style.opacity):null,transform:style?.transform,duration:style?.animationDuration,name:style?.animationName,canvas:{x:c.x,y:c.y,width:c.width,height:c.height}});
      if(t-start<500)requestAnimationFrame(loop);else resolve(frames);
    };requestAnimationFrame(loop);
  }),{id,subtab});
  const opaque=frames=>frames.every(f=>f.background!=='transparent'&&f.background!=='rgba(0, 0, 0, 0)'&&f.surfaceOpacity===1);
  const results=[];
  for(const id of ['sources','zones','layers','loadReport','changes','cost','measurements','extensions','environment','pointclouds','model','changeSets','placement']){
    const trace=sample(id);await page.evaluate(id=>globalThis.__ifc_lite_viewer_store__.getState().showWorkspacePanel(id),id);const frames=await trace;
    const middle=frames.filter(f=>f.contentOpacity!==null&&f.contentOpacity<.99&&f.contentOpacity>.45);
    const row={id,opaque:opaque(frames),intermediateFrames:middle.length,duration:frames.find(f=>f.duration)?.duration,frames};results.push(row);
    if(!baseline){assert.ok(row.opaque,`${id} must have an opaque permanent background throughout the switch`);assert.equal(row.duration,'0.32s',`${id} uses shared slower motion`);assert.ok(middle.length>=6,`${id} interpolates content`);}
    for(const f of frames)assert.deepEqual(f.canvas,frames[0].canvas,'tab content must not resize the camera surface');
    if(id==='sources'||id==='placement')await page.screenshot({path:join(dir,`${id}.png`)});
  }
  await writeFile(join(dir,'surfaces.json'),JSON.stringify(results,null,2));
  passed('all requested panel surfaces remain opaque while content animates',results.map(({id,opaque,intermediateFrames,duration})=>({id,opaque,intermediateFrames,duration})));
  await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().showWorkspacePanel('sources'));await page.waitForTimeout(600);
  const view=await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint());
  const bounds=await page.locator('.viewer-sidebar-reveal > .panel-container').boundingBox();
  const roi={x:Math.ceil(bounds.x+10),y:Math.ceil(bounds.y+bounds.height*.62),width:Math.floor(bounds.width-20),height:Math.floor(bounds.height*.28)};
  await page.screenshot({path:join(dir,'surface-orbit-a.png'),clip:roi});
  await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.orbit(180,0));await page.waitForTimeout(1000);
  await page.screenshot({path:join(dir,'surface-orbit-b.png'),clip:roi});
  await page.evaluate(view=>globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.applyViewpoint(view,false),view);
  await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().showWorkspacePanel('placement'));await page.waitForTimeout(400);
  const placement=page.locator('.viewer-sidebar-reveal > .panel-container');
  for(const name of ['Georeference','Local','Georeference','Local']){
    const trace=sample('placement',true);await placement.getByRole('tab',{name,exact:true}).click();const frames=await trace;
    if(!baseline){assert.ok(opaque(frames),`${name}: tab fade must never expose the IFC`);assert.ok(frames.some(f=>f.duration==='0.32s'),`${name}: shared tab duration`);}
    await writeFile(join(dir,`placement-${result.assertions.length}.json`),JSON.stringify({name,frames},null,2));
    passed(`Placement ${name} switches on a permanent background`,{opaque:opaque(frames),intermediateFrames:frames.filter(f=>f.contentOpacity<.99&&f.contentOpacity>.45).length});
  }
  // Camera-only fixtures derive three contact-region candidates from real loaded mesh AABBs.
  // They exercise actual ClashPanel navigation, not detection correctness.
  const fixtures=await page.evaluate(()=>{
    const s=globalThis.__ifc_lite_viewer_store__.getState(),m=[...s.models.values()][0],boxes=[];
    for(const mesh of m.geometryResult.meshes){const ref=s.resolveGlobalIdFromModels(mesh.expressId);if(!ref)continue;
      const p=mesh.positions,o=mesh.origin??[0,0,0],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<p.length;i+=3)for(let a=0;a<3;a++){min[a]=Math.min(min[a],p[i+a]+o[a]);max[a]=Math.max(max[a],p[i+a]+o[a]);}
      boxes.push({id:mesh.expressId,ref,min,max,key:m.ifcDataStore.entities.getGlobalId(ref.expressId)});
    }
    const clashes=[];
    for(let i=0;i<boxes.length&&clashes.length<3;i+=7){const a=boxes[i];for(let j=i+1;j<Math.min(boxes.length,i+250);j++){const b=boxes[j];if(a.id===b.id)continue;
      const min=a.min.map((v,k)=>Math.max(v,b.min[k])),max=a.max.map((v,k)=>Math.min(v,b.max[k]));if(!min.every((v,k)=>max[k]-v>1e-6))continue;
      const point=min.map((v,k)=>(v+max[k])/2);if(clashes.some(c=>Math.hypot(...point.map((v,k)=>v-c.point[k]))<8))continue;
      const n=clashes.length+1;clashes.push({id:`motion-${n}`,a:{key:a.key||`expressid:${a.ref.expressId}`,ref:a.id,model:m.id,tag:`Motion ${n} A`},b:{key:b.key||`expressid:${b.ref.expressId}`,ref:b.id,model:m.id,tag:`Motion ${n} B`},rule:'motion',status:'hard',distance:-.01,point,bounds:{min,max},severity:'major'});break;
    }}
    globalThis.__ifc_lite_viewer_store__.setState({clashExclusions:[]});s.setClashGroupBy('severity');s.setClashResult({clashes,summary:{total:clashes.length,byRule:{motion:clashes.length},byTypePair:{},bySeverity:{critical:0,major:clashes.length,minor:0,info:0}},rulesRun:[],settings:{tolerance:.002,excludeVoidsAndHosts:true}});s.showWorkspacePanel('clash');return clashes;
  });assert.equal(fixtures.length,3);await writeFile(join(dir,'camera-clash-fixtures.json'),JSON.stringify(fixtures,null,2));
  const clash=page.locator('.viewer-sidebar-reveal > .panel-container');await clash.getByRole('button').filter({hasText:'Motion 1 A'}).first().click();await page.waitForTimeout(1800);
  const cameraTrace=()=>page.evaluate(()=>new Promise(resolve=>{const frames=[];let start;const loop=t=>{start??=t;frames.push({time:t-start,pose:globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint()});if(t-start<1900)requestAnimationFrame(loop);else resolve(frames);};requestAnimationFrame(loop);}));
  const trace=cameraTrace();await clash.getByRole('button').filter({hasText:'Motion 2 A'}).first().click();const frames=await trace;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z),end=frames.at(-1).pose.target,start=frames[0].pose.target,span=distance(start,end);
  assert.ok(span>1,'different real contact regions require camera travel');
  const settled=frames.find(f=>distance(f.pose.target,end)<Math.max(1e-5,span*.005));
  const distinct=new Set(frames.map(f=>JSON.stringify(f.pose))).size;
  await writeFile(join(dir,'clash-transition.json'),JSON.stringify({settledMs:settled?.time,distinct,frames},null,2));
  if(!baseline){assert.ok(settled.time>=550,`clash camera must not rush: ${settled.time} ms`);assert.ok(distinct>25,'camera traverses intermediate poses');}
  passed('actual clash rows animate between real model regions',{settledMs:settled?.time,distinct});
  await clash.getByRole('button').filter({hasText:'Motion 1 A'}).first().click();await page.waitForTimeout(100);
  await clash.getByRole('button').filter({hasText:'Motion 3 A'}).first().click();await page.waitForTimeout(1900);
  const final=await page.evaluate(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();return{id:s.clashSelectedId,pose:s.cameraCallbacks.getViewpoint()};});
  assert.equal(final.id,'motion-3');assert.ok(distance(final.pose.target,{x:fixtures[2].point[0],y:fixtures[2].point[1],z:fixtures[2].point[2]})<1e-4);
  passed('rapid clash changes settle on the last requested region');
  await page.screenshot({path:join(dir,'clash.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().showWorkspacePanel('placement'));
  assert.equal(await page.locator('.viewer-sidebar-reveal .viewer-panel-enter').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().showWorkspacePanel('clash'));
  await clash.getByRole('button').filter({hasText:'Motion 1 A'}).first().click();await page.waitForTimeout(80);
  const reduced=await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint());
  if(!baseline)assert.ok(distance(reduced.target,{x:fixtures[0].point[0],y:fixtures[0].point[1],z:fixtures[0].point[2]})<1e-4,'reduced motion skips the camera tween');
  passed('reduced motion disables panel and clash transitions');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(view=>{const s=globalThis.__ifc_lite_viewer_store__.getState();s.showWorkspacePanel('sources');s.cameraCallbacks.applyViewpoint(view,false);},view);
  const darkTheme=await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().theme);
  for(const theme of ['light','colorful',darkTheme]){
    await page.evaluate(theme=>globalThis.__ifc_lite_viewer_store__.setState({theme}),theme);await page.waitForTimeout(500);
    const name=theme===darkTheme?'dark':theme;
    await page.screenshot({path:join(dir,`surface-${name}-a.png`),clip:roi});
    await page.evaluate(()=>globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.orbit(180,0));await page.waitForTimeout(1000);
    await page.screenshot({path:join(dir,`surface-${name}-b.png`),clip:roi});
    await page.evaluate(view=>globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.applyViewpoint(view,false),view);
  }
  passed('panel pixels captured over changing geometry in light, dark and colorful themes');

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
