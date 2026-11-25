/** Private diagnostic. Installs timing hooks only; never starts a load, opens
 * a window, edits a model, or retains geometry/source payloads. Node 22+. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

const [mode,sessionPath,outPath]=process.argv.slice(2);
assert.ok(['install','status','export','uninstall'].includes(mode),
  'usage: node native-load-repro.mjs install|status|export|uninstall <session.json> [out.json]');
assert.ok(sessionPath,'an explicit diagnostic session.json is required');
const session=JSON.parse(await readFile(sessionPath,'utf8'));
assert.ok(Number.isSafeInteger(session.port)&&session.port>0&&session.port<65536);
const targets=await (await fetch(`http://127.0.0.1:${session.port}/json`)).json();
const target=targets.find(item=>item.type==='page'&&item.url.startsWith('http://tauri.localhost/'));
assert.ok(target,'only the existing local Tauri viewer is eligible');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let sequence=0;
const pending=new Map();
socket.onmessage=event=>{
  const data=JSON.parse(event.data),entry=pending.get(data.id);
  if(!entry)return;
  pending.delete(data.id);clearTimeout(entry.timer);
  data.error?entry.reject(new Error(JSON.stringify(data.error))):entry.resolve(data.result);
};
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timed out`));},30000);
  pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
});
const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};

// This function executes inside the already-open viewer. It wraps the exact
// invoke captured by createNativeIfcRuntime on its NEXT ordinary UI load.
function install() {
  const key='__ifcliteNativeLoadRepro';
  if(globalThis[key]?.installed)return {installed:true,alreadyInstalled:true};
  const internals=globalThis.__TAURI_INTERNALS__,runtime=globalThis.__IFCLITE_NATIVE__;
  if(!internals||!runtime)throw new Error('Expected the native desktop runtime');
  const invoke=internals.invoke,load=runtime.load;
  const owner={installed:true,latest:null};
  globalThis[key]=owner;
  const bytes=value=>value instanceof ArrayBuffer||ArrayBuffer.isView(value)?value.byteLength:0;
  internals.invoke=async function(command,args,options) {
    const state=owner.latest;
    if(!state?.active||!command.startsWith('native_'))return invoke.call(this,command,args,options);
    const start=performance.now();
    let value,error;
    try{value=await invoke.call(this,command,args,options);return value;}
    catch(cause){error=String(cause);throw cause;}
    finally{
      const end=performance.now(),size=bytes(value),input=bytes(args);
      const row={command,start,end,ms:end-start,inputBytes:input,outputBytes:size};
      if(error)row.error=error;
      if(command==='native_next_packet'&&size>=4){
        const view=value instanceof ArrayBuffer?new DataView(value):new DataView(value.buffer,value.byteOffset,value.byteLength);
        row.magic=view.getUint32(0,true).toString(16);
      }
      if(state.calls.length<200000)state.calls.push(row);else state.droppedCallRows++;
      const total=state.commandTotals[command]??={calls:0,sumMs:0,maxMs:0,inputBytes:0,outputBytes:0,empty:0,errors:0};
      total.calls++;total.sumMs+=row.ms;total.maxMs=Math.max(total.maxMs,row.ms);
      total.inputBytes+=input;total.outputBytes+=size;if(!size)total.empty++;if(error)total.errors++;
    }
  };
  runtime.load=async function(file,options) {
    if(owner.latest?.active)throw new Error('The load diagnostic requires non-overlapping native loads');
    const state={active:true,started:new Date().toISOString(),start:performance.now(),
      file:{name:file.name,size:file.size,lastModified:file.lastModified},calls:[],commandTotals:{},
      phases:[],droppedCallRows:0,visibility:{start:document.visibilityState,hiddenObserved:false}};
    owner.latest=state;
    const hidden=()=>{if(document.visibilityState!=='visible')state.visibility.hiddenObserved=true;};
    document.addEventListener('visibilitychange',hidden);
    const onProgress=(phase,percent,indeterminate)=>{
      const last=state.phases.at(-1);
      if(!last||last.phase!==phase||performance.now()-last.at>=1000)
        state.phases.push({phase,percent,indeterminate:!!indeterminate,at:performance.now()});
      options.onProgress(phase,percent,indeterminate);
    };
    try{
      const result=await load.call(this,file,{...options,onProgress});
      state.result={stats:result.stats,diagnostics:result.diagnostics,
        flatMeshes:result.meshes.length,shards:result.instancedShards?.length??0,
        shardBytes:result.instancedShards?.reduce((sum,shard)=>sum+shard.byteLength,0)??0,
        instanceBounds:result.instancedGeometryAabbs?.size??0,
        coordinateInfo:result.coordinateInfo,entities:result.dataModel.entities.size};
      return result;
    }catch(error){state.error=String(error);throw error;}
    finally{
      document.removeEventListener('visibilitychange',hidden);
      state.end=performance.now();state.elapsedMs=state.end-state.start;
      state.active=false;state.visibility.end=document.visibilityState;
    }
  };
  owner.uninstall=()=>{internals.invoke=invoke;runtime.load=load;owner.installed=false;};
  return {installed:true,action:'Use the normal File/Open path, then export. No load was started.'};
}

try{
  let result;
  if(mode==='install')result=await evaluate(`(${install.toString()})()`);
  else if(mode==='uninstall')result=await evaluate(`(()=>{const p=globalThis.__ifcliteNativeLoadRepro;if(p?.latest?.active)throw new Error('Cannot remove hooks during a native load');p?.uninstall();return {installed:p?.installed??false};})()`);
  else result=await evaluate(`(()=>{const p=globalThis.__ifcliteNativeLoadRepro,s=p?.latest;if(!s)return {installed:p?.installed??false,load:null};return ${mode==='export'?'s':"{active:s.active,file:s.file,elapsedMs:(s.end??performance.now())-s.start,lastPhase:s.phases.at(-1),commandTotals:s.commandTotals,error:s.error}"};})()`);
  if(mode==='export'){
    assert.ok(outPath,'export requires an output JSON path');
    const report={session:{exe:session.exe,sha256:session.sha256,pid:session.pid,port:session.port},
      method:'RPC intervals and native load progress; overlaps are retained, not additive phase times',load:result};
    await writeFile(outPath,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({outPath,active:result.active,elapsedMs:result.elapsedMs,
      phases:result.phases?.length,calls:result.calls?.length,droppedCallRows:result.droppedCallRows}));
  }else console.log(JSON.stringify(result));
}finally{socket.close();}
