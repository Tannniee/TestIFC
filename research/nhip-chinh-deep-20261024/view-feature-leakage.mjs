import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { writeFile, appendFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
const out = process.env.DIAG_OUT || import.meta.dirname;
const exe = process.env.DIAG_EXE || 'F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-packages-audit-20261020-r3/IFC-Lite.exe';
const model = process.env.DIAG_MODEL || 'F:/Working/IFC Temp/Nhip chinh.ifc';
const profile = join(out, `webview-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const server = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
const started = Date.now();
const report = { exe, model, profile, started: new Date().toISOString(), console: [], errors: [], states: [], events: [] };
const log = async value => { const row = { seconds: +( (Date.now()-started)/1000).toFixed(2), ...value }; await appendFile(join(out, 'events.jsonl'), JSON.stringify(row)+'\n'); return row; };
const child = spawn(exe, [], { windowsHide: true, env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --no-first-run` }, stdio: ['ignore','pipe','pipe'] });
report.pid = child.pid;
child.stdout.on('data', b => appendFile(join(out,'native-stdout.log'), b));
child.stderr.on('data', b => appendFile(join(out,'native-stderr.log'), b));
child.on('exit', (code, signal) => { report.exit = {code,signal}; console.log('HOST EXIT',code,signal); });
let browser, page, cdp;
const timeout = (p, ms=6000) => Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Diagnostic request timeout')),ms))]);
try {
  for(let i=0;i<120;i++) { if(child.exitCode!==null) throw new Error('Host exited before connection'); try { if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {} await new Promise(r=>setTimeout(r,250)); }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts().flatMap(c=>c.pages())[0];
  page.on('console', m => { const e={type:m.type(),text:m.text()}; report.console.push(e); void log({console:e}); });
  page.on('pageerror', e => { report.errors.push(e.stack); void log({error:e.stack}); });
  page.on('crash', () => {report.events.push('renderer crash'); void log({event:'renderer crash'}); console.log('RENDERER CRASH');});
  page.on('close', () => {report.events.push('page closed');});
  await page.waitForFunction(()=>!!globalThis.__ifc_lite_viewer_store__,null,{timeout:60000});
  cdp = await browser.contexts()[0].newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.evaluate(()=>{ const original=globalThis.__TAURI_INTERNALS__.invoke; globalThis.__diagNative={}; globalThis.__TAURI_INTERNALS__.invoke=async function(cmd,args,options){const result=await original.call(this,cmd,args,options); if(cmd==='native_job_status') globalThis.__diagNative=result; else if(cmd==='native_create_job') globalThis.__diagJob=result; return result;}; });
  report.backend = await page.evaluate(()=>globalThis.__TAURI_INTERNALS__.invoke('native_backend_info'));
  console.log('LAUNCH',JSON.stringify({pid:child.pid,port,backend:report.backend}));
  await page.screenshot({path:join(out,'before-load.png')});
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input-open' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [model] });
  for(let i=0;i<180 && Date.now()-started<200000;i++) {
    await new Promise(r=>setTimeout(r,1000));
    if(child.exitCode!==null || page.isClosed()) break;
    try {
      const state=await timeout(page.evaluate(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState(); const n=globalThis.__diagNative; return {loading:s.loading,loadError:s.loadError,progress:s.loadingProgress,phase:s.loadingPhase,job:globalThis.__diagJob,native:{done:n.done,error:n.error,progress:n.progress,stats:n.summary?.stats},models:[...s.models.values()].map(m=>({name:m.name,error:m.loadError,path:m.loadPath,meshes:m.geometryResult?.meshes?.length,entities:m.ifcDataStore?.entityCount})),body:document.body.innerText.slice(-900)};}));
      report.states.push(await log({state}));
      if(i%10===0) { console.log('STATE',i,JSON.stringify(state)); await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)); }
      if(!state.loading && (state.models.length || state.loadError || report.errors.length)) { await page.waitForTimeout(1500); await page.screenshot({path:join(out,'after-load.png')});
      report.featureLeakage=await page.evaluate(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();const m=[...s.models.values()][0];const types={};const features=new Map();for(const mesh of m.geometryResult.meshes){types[mesh.ifcType]=(types[mesh.ifcType]||0)+1;if(mesh.ifcType!=='IfcVoidingFeature')continue;let box=features.get(mesh.expressId);if(!box){box={id:mesh.expressId,color:mesh.color,triangles:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};features.set(mesh.expressId,box);}box.triangles+=mesh.indices.length/3;const o=mesh.origin||[0,0,0];for(let k=0;k<mesh.positions.length;k++) {const axis=k%3;box.min[axis]=Math.min(box.min[axis],mesh.positions[k]+o[axis]);box.max[axis]=Math.max(box.max[axis],mesh.positions[k]+o[axis]);}}const large=[...features.values()].map(b=>({...b,dimensions:b.max.map((x,i)=>x-b.min[i])})).sort((a,b)=>Math.max(...b.dimensions)-Math.max(...a.dimensions)).slice(0,25);return{models:s.models.size,idOffset:m.idOffset,typeVisibility:s.typeVisibility,types,featureEntities:features.size,largest:large,camera:s.cameraCallbacks.getViewpoint()};});
      const negativeIds=JSON.parse(await readFile(join(import.meta.dirname,'negative-ids.json'),'utf8'));
      await page.evaluate(ids=>{const s=globalThis.__ifc_lite_viewer_store__.getState();if(s.models.size!==1)throw new Error('Single-model fallback required');s.hideEntities(ids);},negativeIds);
      await page.waitForTimeout(2500);await page.screenshot({path:join(out,'negative-features-hidden.png')});
      report.hiddenFeatureIds=negativeIds.length;
      report.completed=true; break; }
    } catch(e) { await log({probeError:String(e)}); console.log('PROBE ERROR',String(e)); if(report.events.includes('renderer crash')) break; }
  }
  if(!page.isClosed()) { try { await timeout(page.screenshot({path:join(out,'final.png'),timeout:5000}),7000); } catch(e) { report.screenshotError=String(e); } }
} catch(e) { report.failure=e.stack; console.log('FAILURE',e.stack); }
finally { report.finished=new Date().toISOString(); await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)); if(child.exitCode===null && child.pid) spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}); console.log('REPORT',join(out,'report.json')); process.exit(0); }

