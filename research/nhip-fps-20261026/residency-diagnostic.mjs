import {attach} from './cdp.mjs';
const c=await attach();
try{
 console.log(await c.evaluate(`(()=>{
 const r=globalThis.__svdRenderer,s=r.getScene();
 if(!s.__timedRestores){
  s.__timedRestores=true;const restore=s.processResidencyRestores;
  s.processResidencyRestores=function(...args){const t=performance.now();const count=restore.apply(this,args);const p=globalThis.__svdProbe;if(p?.active)p.restores.push({t,ms:performance.now()-t,count});return count;};
 }
 const before={gpu:s.getGpuResidencyBudget(),host:s.hostBudgetBytes,evicted:s.getBatchedMeshes().filter(b=>b.gpuResident===false).length};
 if(${process.env.DISABLE_RESIDENCY==='1'}){
  s.setGpuResidencyBudget(null);s.setHostResidencyBudget(null);
  s.restoreAllEvicted(r.getGPUDevice(),r.getPipeline());r.requestRender();
 }else{s.setGpuResidencyBudget(2048*1024*1024);s.setHostResidencyBudget(3072*1024*1024);}
 return {before,after:{gpu:s.getGpuResidencyBudget(),host:s.hostBudgetBytes,evicted:s.getBatchedMeshes().filter(b=>b.gpuResident===false).length}};
 })()`));
}finally{c.close();}
