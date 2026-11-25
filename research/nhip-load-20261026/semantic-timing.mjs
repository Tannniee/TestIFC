import {attach} from '../nhip-fps-20261026/cdp.mjs';
import {writeFile} from 'node:fs/promises';
const c=await attach();
try{
 const result=await c.evaluate(`(async()=>{
  const invoke=globalThis.__TAURI_INTERNALS__.invoke,start=performance.now();
  const id=await invoke('native_import_path',{path:'F:/Working/IFC Temp/Nhip chinh.ifc'});
  const imported=performance.now();
  try{
   const bytes=await invoke('native_prepare_semantics',{id,rootedOnly:true}),prepared=performance.now();
   let received=0,packets=0;
   for(;;){const p=await invoke('native_next_semantic_packet',{id});if(!p.byteLength)break;received+=p.byteLength;packets++;}
   const ended=performance.now();
   return {importMs:imported-start,prepareMs:prepared-imported,receiveMs:ended-prepared,totalMs:ended-start,
    bytes,received,packets,scope:'Standalone immutable snapshot + rooted semantic serialization + raw bounded IPC; excludes frontend column/map decoding and geometry. Existing model/viewer state is untouched.'};
  }finally{await invoke('native_close_job',{id});}
 })()`,true);
 await writeFile('research/nhip-load-20261026/semantic-timing.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{c.close();}
