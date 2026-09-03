import {chromium,expect} from "../frontend/node_modules/@playwright/test/index.mjs";
import {spawn} from "node:child_process";
import {copyFile,mkdir,readFile,writeFile,stat} from "node:fs/promises";
import {createServer} from "node:net";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const output=path.resolve(root,process.env.IFC_WORKSPACE_BENCH_OUTPUT||`benchmarks/results/workspace-large-${Date.now()}`);
const sourceCache=path.resolve(root,process.env.IFC_WORKSPACE_BENCH_CACHE||"benchmarks/results/large-models-final-2026-09-02/cache");
const model=process.env.IFC_WORKSPACE_BENCH_MODEL;
const small=process.env.IFC_E2E_MODEL_B;
const hash=process.env.IFC_WORKSPACE_BENCH_HASH;
if(!model||!small||!hash)throw new Error("Set large model, small model and large model hash");
if(await stat(path.join(output,"result.json")).catch(()=>null))throw new Error("Use a fresh benchmark output directory");
if((await stat(path.join(sourceCache,hash+".semantic-v3.sqlite-wal")).catch(()=>null))?.size)throw new Error("Source cache is not a closed database snapshot");
await mkdir(path.join(output,"cache"),{recursive:true});
for(const suffix of [".ifc",".fragments-v2-full.frag",".semantic-v3.sqlite"])
  await copyFile(path.join(sourceCache,hash+suffix),path.join(output,"cache",hash+suffix));
const probe=createServer();await new Promise(r=>probe.listen(0,"127.0.0.1",r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const stop=path.join(output,"backend.stop"),token=crypto.randomUUID()+crypto.randomUUID(),children=[];
function launch(command,args,name,env={}){const child=spawn(command,args,{cwd:root,windowsHide:true,env:{...process.env,IFC_API_SESSION_TOKEN:token,...env},stdio:["ignore","pipe","pipe"]});let log="";child.stdout.on("data",d=>log+=d);child.stderr.on("data",d=>log+=d);child.on("exit",()=>writeFile(path.join(output,name+".log"),log));children.push(child);return child;}
const backend=launch(path.join(root,".venv/Scripts/python.exe"),["benchmarks/serve_benchmark.py",String(port),stop],"backend",{IFC_MODEL_CACHE_DIR:path.join(output,"cache"),IFC_CACHE_KEEP_MODELS:"5"});
const vite=launch(process.execPath,["frontend/node_modules/vite/bin/vite.js","frontend","--host","127.0.0.1","--port",String(port+1),"--strictPort"],"vite",{IFC_BRIDGE_URL:`http://127.0.0.1:${port}`});
launch(path.join(root,".venv/Scripts/python.exe"),["benchmarks/windows_resource_monitor.py",String(process.pid),path.join(output,"resources.jsonl"),path.join(output,"phase.json")],"monitor");
const delay=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok&&(await fetch(`http://127.0.0.1:${port+1}`)).ok)break;}catch{}await delay(200);if(i===99)throw new Error("benchmark server startup failed");}
let browser;const result={model,path:model,modelHash:hash,sourceCache:"copied from prior closed benchmark cache",viewport:{width:1440,height:900},warnings:[],errors:[]};
try{
 browser=await chromium.launch({headless:true,args:["--use-angle=d3d11"]});const context=await browser.newContext({viewport:result.viewport});const page=await context.newPage();
 page.on("pageerror",e=>result.errors.push(String(e)));page.on("console",m=>{if(["warning","error"].includes(m.type())&&result.warnings.length<30)result.warnings.push(m.text());});
 await page.addInitScript(()=>{window.__metrics=[];window.addEventListener("ifc-fragment-metrics",e=>window.__metrics.push(e.detail));window.addEventListener("ifc-viewer-ready",e=>window.viewer=e.detail);});
 await page.goto(`http://127.0.0.1:${port+1}/?viewerDebug=1`);await page.waitForFunction(()=>window.viewer,undefined,{timeout:30000});
 const implementation=page._connection?.toImpl?.(page),sessions=implementation?.delegate?._networkManager?._sessions;
 if(!(sessions instanceof Map)||!sessions.size)throw new Error("Cannot disable binary body telemetry");for(const {session}of sessions.values())await session.send("Network.disable");
 const session=await context.newCDPSession(page);await session.send("Performance.enable");const browserSession=await browser.newBrowserCDPSession();result.gpu=(await browserSession.send("SystemInfo.getInfo"))?.gpu?.devices;
 result.webgl=await page.evaluate(()=>{const gl=window.viewer.renderer.getContext(),extension=gl.getExtension("WEBGL_debug_renderer_info");window.__renderer=window.viewer.renderer;return extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null;});
 await page.evaluate(()=>{
   const p=window.__probe={phase:"load",input:[],render:[],longTasks:[],pending:[]};const render=window.viewer.renderer.render.bind(window.viewer.renderer);
   window.viewer.renderer.render=(...args)=>{const start=performance.now();const value=render(...args);const end=performance.now();p.render.push({phase:p.phase,ms:end-start});for(const input of p.pending.splice(0))p.input.push({phase:input.phase,ms:end-input.at});return value;};
   for(const type of ["pointerdown","pointermove"])document.addEventListener(type,event=>{if(event.target instanceof HTMLCanvasElement||event.target?.classList?.contains("section-box-handle"))p.pending.push({phase:p.phase,at:performance.now()});},true);
   new PerformanceObserver(list=>{for(const task of list.getEntries())p.longTasks.push({phase:p.phase,ms:task.duration});}).observe({type:"longtask",buffered:false});
 });
 const phase=async name=>{await writeFile(path.join(output,"phase.json"),JSON.stringify({model:hash,phase:name}));await page.evaluate(name=>{window.__probe.phase=name;window.__probe.pending=[];},name);console.log(name);};
 const input=page.locator("input[type=file]"),docs=page.locator('.document-tabs [role="tab"]');
 const load=async(file,index)=>{const started=performance.now();await input.setInputFiles(file);await expect.poll(()=>page.evaluate(()=>window.__metrics.length),{timeout:180000}).toBe(index);return performance.now()-started;};
 await phase("warm-load");result.loadLargeMs=await load(model,1);result.fragment=await page.evaluate(()=>window.__metrics[0]);expect(result.fragment.modelHash).toBe(hash);expect(result.fragment.cacheHit).toBe(true);
 await phase("browser");await page.getByRole("button",{name:"Project Browser",exact:true}).click();const startedTree=performance.now();await page.getByRole("button",{name:"Model",exact:true}).click();await expect.poll(()=>page.getByRole("treeitem").count(),{timeout:120000}).toBeGreaterThan(0);result.browserInitialMs=performance.now()-startedTree;
 for(let i=0;i<14;i++){const expandable=page.locator('.tree-expand[aria-expanded="false"]:not(:disabled)').first();if(!await expandable.count())break;await expandable.click();await delay(30);}
 result.browser=await page.evaluate(()=>{const scroll=document.querySelector(".model-tree-scroll"),tree=scroll?.firstElementChild;return{domRows:document.querySelectorAll('[role="treeitem"]').length,totalRows:Math.round(parseFloat(tree?.style.height||"0")/28),scrollHeight:scroll?.scrollHeight};});
 await phase("browser-scroll");const tree=page.locator(".model-tree-scroll");const scrollStarted=performance.now();for(let i=0;i<50;i++){await tree.evaluate((e,i)=>e.scrollTop=e.scrollHeight*i/49,i);await page.evaluate(()=>new Promise(requestAnimationFrame));}result.browserScrollMs=performance.now()-scrollStarted;
 await page.getByRole("button",{name:"Close Project Browser",exact:true}).click();
 await page.getByRole("button",{name:"Section Box",exact:true}).click();await expect(page.locator(".viewer-mount")).toHaveClass(/viewer-box-zoom-active/);const c=await page.locator("canvas").boundingBox();await page.mouse.move(c.x+c.width*.25,c.y+c.height*.25);await page.mouse.down();await page.mouse.move(c.x+c.width*.75,c.y+c.height*.75,{steps:10});await page.mouse.up();await expect(page.getByRole("tab",{name:"Section Box 1",exact:true})).toBeVisible();
 await phase("box-drag");const handle=page.locator('.section-box-handle[data-section-face="x-min"]');const h=await handle.boundingBox();const dragStart=performance.now();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();for(let i=0;i<90;i++){await page.mouse.move(h.x+i*.5,h.y+Math.sin(i/8)*20);await delay(8);}await page.mouse.up();await page.evaluate(()=>new Promise(requestAnimationFrame));result.boxDragMs=performance.now()-dragStart;
 await phase("view-switch");result.viewSwitchMs=[];for(let i=0;i<3;i++){for(const name of ["3D View","Section Box 1"]){const start=performance.now(),tab=page.getByRole("tab",{name,exact:true});await tab.click();await expect(tab).toHaveAttribute("aria-selected","true",{timeout:120000});const ms=performance.now()-start;result.viewSwitchMs.push(ms);console.log(JSON.stringify({view:name,ms}));}}
 const countBeforeReopen=await page.evaluate(()=>window.__metrics.length);expect(countBeforeReopen).toBe(1);
 await phase("document-reactivation");await load(small,2);const snapshots=[];
 for(let i=0;i<4;i++){
   await docs.nth(1).click();await expect(docs.nth(1)).toHaveAttribute("aria-selected","true",{timeout:60000});
   await docs.nth(0).click();await expect(docs.nth(0)).toHaveAttribute("aria-selected","true",{timeout:180000});await session.send("HeapProfiler.collectGarbage");const performanceMetrics=await session.send("Performance.getMetrics");
   snapshots.push(await page.evaluate(()=>({models:window.viewer.loader.fragments.models.list.size,canvas:document.querySelectorAll(".viewer-mount canvas").length,helpers:document.querySelectorAll(".section-box-handle").length,sameRenderer:window.viewer.renderer===window.__renderer,rendererInfo:{memory:{...window.viewer.renderer.info.memory},programs:window.viewer.renderer.info.programs?.length??null}})));
   snapshots.at(-1).jsHeapUsed=performanceMetrics.metrics.find(m=>m.name==="JSHeapUsedSize")?.value;console.log(JSON.stringify({cycle:i+1,snapshot:snapshots.at(-1)}));
 }
 result.reactivation=snapshots;result.metrics=await page.evaluate(()=>window.__metrics);result.liveInvariant=snapshots.every(s=>s.models===1&&s.canvas===1&&s.helpers===6&&s.sameRenderer);result.probe=await page.evaluate(()=>{const p=window.__probe;const stats=rows=>{const groups={};for(const row of rows)(groups[row.phase]??=[]).push(row.ms);return Object.fromEntries(Object.entries(groups).map(([phase,values])=>{values.sort((a,b)=>a-b);return[phase,{count:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],max:values.at(-1)}];}));};return{inputToRender:stats(p.input),renderCpu:stats(p.render),longTasks:stats(p.longTasks)};});result.status=result.errors.length||!result.liveInvariant?"failed":"passed";
 await page.screenshot({path:path.join(output,"large-section-box.png")});const resources=(await readFile(path.join(output,"resources.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));result.resources={peakPrivateBytes:Math.max(...resources.map(r=>r.privateBytes)),minimumAvailableBytes:Math.min(...resources.map(r=>r.availableBytes)),samples:resources.length,scope:"benchmark process tree including browser, frontend and backend"};await writeFile(path.join(output,"result.json"),JSON.stringify(result,null,2));
}catch(error){result.status="failed";result.error=String(error);await writeFile(path.join(output,"result.json"),JSON.stringify(result,null,2));throw error;}
finally{await writeFile(stop,"stop");await delay(1200);for(const child of children)if(child.exitCode===null)child.kill();await browser?.close();}
console.log(JSON.stringify({output,status:result.status,loadLargeMs:result.loadLargeMs,browser:result.browser,liveInvariant:result.liveInvariant}));
