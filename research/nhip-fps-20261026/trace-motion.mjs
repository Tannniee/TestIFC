import {attach,dir} from './cdp.mjs';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const c=await attach();
const label=process.env.SVD_LABEL||'trace-motion';
try{
 const complete=new Promise(resolve=>c.listeners.add(m=>{if(m.method==='Tracing.tracingComplete')resolve(m.params.stream);}));
 await c.send('Tracing.start',{categories:'devtools.timeline,v8,disabled-by-default-v8.gc',transferMode:'ReturnAsStream'});
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['research/nhip-fps-20261026/measure.mjs'],{windowsHide:true,stdio:'inherit',
   env:{...process.env,SVD_LABEL:label,SVD_GESTURES:'orbit,pan,zoom',SVD_GPU:'0',SVD_ZOOM_FACTOR:'.15'}});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Motion diagnosis exited ${code}`)));
 });
 await c.send('Tracing.end');const stream=await complete;let trace='';
 for(;;){const r=await c.send('IO.read',{handle:stream,size:1024*1024});trace+=r.base64Encoded?Buffer.from(r.data,'base64').toString():r.data;if(r.eof)break;}
 await c.send('IO.close',{handle:stream});await writeFile(`${dir}/${label}.trace.json`,trace);
 const events=JSON.parse(trace).traceEvents;
 const gc=events.filter(e=>e.ph==='X'&&e.dur>1000&&/GC|GarbageCollect/.test(e.name)).map(e=>({name:e.name,durationMs:e.dur/1000,ts:e.ts,pid:e.pid,tid:e.tid}));
 const longest=events.filter(e=>e.ph==='X'&&e.dur>50000).sort((a,b)=>b.dur-a.dur).slice(0,40).map(e=>({name:e.name,durationMs:e.dur/1000,args:e.args,pid:e.pid,tid:e.tid,ts:e.ts}));
 await writeFile(`${dir}/${label}-trace-summary.json`,JSON.stringify({gc,longest},null,2));
 console.log(JSON.stringify({gc:gc.filter(x=>x.durationMs>25),longest:longest.slice(0,12)}));
}finally{c.close();}
