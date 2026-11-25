import { writeFile, readFile } from 'node:fs/promises';
import { attach, dir, sleep } from './cdp.mjs';
const c = await attach();
const label = process.env.SVD_LABEL || 'baseline';
const profiled = process.env.SVD_PROFILE === '1';
const report = { label, profiled, zoomFactor:Number(process.env.SVD_ZOOM_FACTOR||1),gpuTiming:process.env.SVD_GPU==='1',at: new Date().toISOString(), tests: [] };
const summary = values => {
  const a = values.slice().sort((a,b) => a-b);
  const q = p => a[Math.max(0, Math.ceil(p*a.length)-1)] ?? null;
  return { n:a.length, mean:a.reduce((x,y)=>x+y,0)/a.length, p50:q(.5),p95:q(.95),p99:q(.99),max:a.at(-1),
    over25:a.filter(x=>x>25).length,over50:a.filter(x=>x>50).length,over100:a.filter(x=>x>100).length };
};
try {
  await c.send('Page.bringToFront');
  report.before = await c.evaluate(`(()=>{const s=globalThis.__ifc_lite_viewer_store__.getState();
    return {loading:s.loading,streaming:s.geometryStreamingActive,fastView:s.fastView,activeTool:s.activeTool,
      stats:globalThis.__ifc_lite_render_stats__?.(),pose:s.cameraCallbacks.getViewpoint(),
      canvas:[...document.querySelectorAll('canvas')].map(x=>({rect:x.getBoundingClientRect().toJSON(),w:x.width,h:x.height,viewport:x.dataset.viewport})),
      view:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState},
      ui:document.body.innerText.slice(-1200)};})()`);
  if(report.before.loading || report.before.streaming) throw Error('Model not fully ready');
  report.settled = await c.evaluate('(()=>{const s=globalThis.__svdRenderer.getScene();return {queued:s.hasQueuedMeshes(),finalizing:s.finalizeInProgress,fragments:s.hasStreamingFragments()};})()');
  if(Object.values(report.settled).some(Boolean)) throw Error('Scene upload/finalization still active: do not treat this as steady-state FPS');
  await c.evaluate("globalThis.__ifc_lite_viewer_store__.getState().setActiveTool('select')");
  const fixedPose=process.env.SVD_POSE_FILE ? JSON.parse(await readFile(process.env.SVD_POSE_FILE,'utf8')).before.pose : report.before.pose;
  await c.evaluate(`(()=>{
    if(globalThis.__svdProbe) return;
    const p=globalThis.__svdProbe={active:false,frames:[],textures:[],submits:[],passes:[],long:[],inputs:[]};
    const texture=GPUCanvasContext.prototype.getCurrentTexture;
    GPUCanvasContext.prototype.getCurrentTexture=function(...args){
      const t=performance.now();const r=texture.apply(this,args);
      if(p.active)p.textures.push({t,ms:performance.now()-t});return r;
    };
    const submit=GPUQueue.prototype.submit;
    GPUQueue.prototype.submit=function(...args){
      const t=performance.now();const r=submit.apply(this,args);
      if(p.active)p.submits.push({t,ms:performance.now()-t});return r;
    };
    const begin=GPUCommandEncoder.prototype.beginRenderPass;
    GPUCommandEncoder.prototype.beginRenderPass=function(d){
      if(p.active)p.passes.push({t:performance.now(),label:d.label??'main'});return begin.call(this,d);
    };
    new PerformanceObserver(list=>{if(p.active)for(const e of list.getEntries())p.long.push({t:e.startTime,ms:e.duration});})
      .observe({type:'longtask',buffered:false});
    for(const type of ['pointermove','pointerdown','pointerup','wheel'])document.addEventListener(type,e=>{
      if(p.active)p.inputs.push({type,t:performance.now(),eventTs:e.timeStamp,buttons:e.buttons});
    },{passive:true,capture:true});
    function tick(t){if(p.active){const v=globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint();
      p.frames.push({t,now:performance.now(),position:v.position});}requestAnimationFrame(tick);}requestAnimationFrame(tick);
  })()`);
  if(profiled){await c.send('Profiler.enable');await c.send('Profiler.setSamplingInterval',{interval:1000});await c.send('Profiler.start');}
  const box=report.before.canvas.find(c=>c.viewport==='main')?.rect ?? report.before.canvas[0].rect;
  const x=box.x+box.width*.5,y=box.y+box.height*.58;
  for(const gesture of (process.env.SVD_GESTURES || 'idle,orbit,pan,zoom,hover').split(',')) {
    await c.evaluate(`globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.applyViewpoint(${JSON.stringify(fixedPose)},false)`);
    await sleep(1800);
    if(report.zoomFactor!==1){await c.evaluate(`(()=>{const r=globalThis.__svdRenderer,v=globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint();r.getCamera().setOrthoSize(v.orthoSize*${report.zoomFactor});r.requestRender();})()`);await sleep(1000);}
    await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await sleep(500);
    const initialPose=await c.evaluate('globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint()');
    const initialRotation=await c.evaluate('globalThis.__svdRenderer.getCamera().getRotation()');
    await c.evaluate(`(()=>{const p=globalThis.__svdProbe;for(const k of ['frames','textures','submits','passes','long','inputs','renders','picks','pickPhases','gpu','gpuErrors','candidateCounts','restores'])p[k]=[];p.gpuTiming=${report.gpuTiming};p.active=true;p.start=performance.now();})()`);
    const start=Date.now(),duration=8000;
    if(['orbit','pan'].includes(gesture))await c.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:gesture==='orbit'?'left':'middle',buttons:gesture==='orbit'?1:4,clickCount:1});
    while(Date.now()-start<duration){
      const t=(Date.now()-start)/1000;
      if(['orbit','pan','hover'].includes(gesture))await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+Math.sin(t*1.3)*140,y:y+Math.sin(t*.9)*65,button:gesture==='pan'?'middle':gesture==='orbit'?'left':'none',buttons:gesture==='pan'?4:gesture==='orbit'?1:0});
      if(gesture==='zoom')await c.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:Math.cos(t*.8)*16});
      await sleep(16);
    }
    if(['orbit','pan'].includes(gesture))await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:gesture==='orbit'?'left':'middle',buttons:0,clickCount:1});
    const raw=await c.evaluate('(()=>{const p=globalThis.__svdProbe;p.end=performance.now();p.active=false;return {start:p.start,end:p.end,frames:p.frames,textures:p.textures,submits:p.submits,passes:p.passes,long:p.long,inputs:p.inputs,renders:p.renders,picks:p.picks,pickPhases:p.pickPhases,gpu:p.gpu,gpuErrors:p.gpuErrors,candidateCounts:p.candidateCounts,restores:p.restores};})()');
    const delta=a=>a.slice(1).map((v,i)=>v.t-a[i].t);
    const r={gesture,durationMs:raw.end-raw.start,rafFps:1000*(raw.frames.length-1)/(raw.frames.at(-1).t-raw.frames[0].t),
      renderedFps:raw.textures.length*1000/(raw.end-raw.start),rafIntervals:summary(delta(raw.frames)),renderIntervals:summary(delta(raw.textures)),
      textureCall:summary(raw.textures.map(x=>x.ms)),longTasks:summary(raw.long.map(x=>x.ms)),
      renderCpu:summary(raw.renders.map(x=>x.ms)),pickCpu:summary(raw.picks.map(x=>x.ms)),
      restoreCpu:summary(raw.restores.map(x=>x.ms)),restoredBatches:raw.restores.reduce((n,x)=>n+x.count,0),
      pickPhases:Object.fromEntries([...new Set(raw.pickPhases.map(x=>x.name))].map(name=>[name,summary(raw.pickPhases.filter(x=>x.name===name).map(x=>x.ms))])),
      gpuMs:summary(raw.gpu.map(f=>f.passes.reduce((n,p)=>n+p.ms,0))),gpuErrors:raw.gpuErrors,
      candidates:summary(raw.candidateCounts.filter(x=>x!==null)),exhaustivePicks:raw.candidateCounts.filter(x=>x===null).length,
      throttles:raw.renders.reduce((o,x)=>(o[x.throttle??0]=(o[x.throttle??0]??0)+1,o),{}),
      inputDelay:summary(raw.inputs.map(x=>x.t-x.eventTs)),passes:raw.passes.reduce((o,x)=>(o[x.label]=(o[x.label]??0)+1,o),{}),
      stats:await c.evaluate('globalThis.__ifc_lite_render_stats__?.()'),
      pose:await c.evaluate('globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint()')};
    r.initialPose=initialPose;
    r.initialRotation=initialRotation;
    r.finalRotation=await c.evaluate('globalThis.__svdRenderer.getCamera().getRotation()');
    if(gesture==='orbit' && JSON.stringify(r.initialRotation)===JSON.stringify(r.finalRotation))throw Error('Orbit gesture did not rotate camera');
    if(gesture==='pan' && JSON.stringify(initialPose.target)===JSON.stringify(r.pose.target))throw Error('Pan gesture did not move target');
    if(gesture==='zoom' && initialPose.orthoSize===r.pose.orthoSize)throw Error('Wheel gesture did not zoom');
    report.tests.push(r);
    await writeFile(`${dir}/${label}-${gesture}-raw.json`,JSON.stringify(raw));
    await writeFile(`${dir}/${label}.json`,JSON.stringify(report,null,2));
    console.log(JSON.stringify(r));
  }
  if(profiled){const r=await c.send('Profiler.stop');await writeFile(`${dir}/${label}.cpuprofile`,JSON.stringify(r.profile));}
  const image=await c.send('Page.captureScreenshot',{format:'png'});
  await writeFile(`${dir}/${label}.png`,Buffer.from(image.data,'base64'));
}finally {c.close();}
