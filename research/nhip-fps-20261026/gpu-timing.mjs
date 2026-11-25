import {attach} from './cdp.mjs';
const c=await attach();
try{console.log(await c.evaluate(`(()=>{
 const device=globalThis.__svdRenderer.getGPUDevice();
 if(!device.features.has('timestamp-query'))return {supported:false};
 if(globalThis.__svdGpuTiming)return {supported:true,installed:true};
 globalThis.__svdGpuTiming=true;
 const slots=Array.from({length:4},()=>({busy:false,query:device.createQuerySet({type:'timestamp',count:32}),
   resolve:device.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),
   read:device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})}));
 const encoders=new WeakMap(),buffers=new WeakMap();
 const begin=GPUCommandEncoder.prototype.beginRenderPass;
 GPUCommandEncoder.prototype.beginRenderPass=function(d){
   const p=globalThis.__svdProbe;
   if(p?.active&&p.gpuTiming){
     let state=encoders.get(this);
     if(!state){const slot=slots.find(s=>!s.busy);if(slot){slot.busy=true;state={slot,labels:[],t:performance.now(),probe:p};encoders.set(this,state);}}
     if(state&&state.labels.length<16){const i=state.labels.length*2;state.labels.push(d.label??'main');
       return begin.call(this,{...d,timestampWrites:{querySet:state.slot.query,beginningOfPassWriteIndex:i,endOfPassWriteIndex:i+1}});}
   }
   return begin.call(this,d);
 };
 const finish=GPUCommandEncoder.prototype.finish;
 GPUCommandEncoder.prototype.finish=function(...args){
   const state=encoders.get(this);
   if(state){this.resolveQuerySet(state.slot.query,0,state.labels.length*2,state.slot.resolve,0);
     this.copyBufferToBuffer(state.slot.resolve,0,state.slot.read,0,state.labels.length*16);}
   const result=finish.apply(this,args);if(state)buffers.set(result,state);return result;
 };
 const submit=GPUQueue.prototype.submit;
 GPUQueue.prototype.submit=function(commands){
   const result=submit.call(this,commands);
   for(const command of commands){const state=buffers.get(command);if(!state)continue;
     state.slot.read.mapAsync(GPUMapMode.READ).then(()=>{
       const values=new BigUint64Array(state.slot.read.getMappedRange());
       const passes=state.labels.map((label,i)=>({label,ms:Number(values[i*2+1]-values[i*2])/1e6}));
       state.slot.read.unmap();state.slot.busy=false;
       if(state.probe.active)state.probe.gpu.push({t:state.t,passes});
     }).catch(error=>{state.slot.busy=false;state.probe.gpuErrors.push(String(error));});
   }
   return result;
 };
 return {supported:true,installed:true,features:[...device.features]};
})()`));}finally{c.close();}
