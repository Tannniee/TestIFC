import { attach } from './cdp.mjs';
const c=await attach();
try{console.log(await c.evaluate(`(()=>{
 const r=globalThis.__svdRenderer;if(!r)throw Error('Missing captured renderer');
 if(globalThis.__svdInstrumented)return 'already instrumented';globalThis.__svdInstrumented=true;
 const render=r.render;
 r.render=function(options){
  const p=globalThis.__svdProbe,t=performance.now();
  const result=render.call(this,options);
  if(p?.active){p.renders??=[];p.renders.push({t,ms:performance.now()-t,interacting:options.isInteracting,
    throttle:options.interactionFrameIntervalMs,draws:this.getFrameStats()?.drawCalls});}
  return result;
 };
 for(const name of ['raycastScene','raycastSceneMagnetic','pick']){
  const original=r[name];r[name]=function(...args){
   const p=globalThis.__svdProbe,t=performance.now();const result=original.apply(this,args);
   if(p?.active){p.picks??=[];p.picks.push({name,t,ms:performance.now()-t});}return result;
  };
 }
 return {adapter:r.getAdapterInfo(),diagnostics:r.getDiagnostics()};
})()`));}finally{c.close();}
