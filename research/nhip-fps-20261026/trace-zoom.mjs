import {attach,dir} from './cdp.mjs';
import {spawn} from 'node:child_process';
import {writeFile,readFile} from 'node:fs/promises';
const c=await attach();
try{
 const complete=new Promise(resolve=>c.listeners.add(message=>{if(message.method==='Tracing.tracingComplete')resolve(message.params.stream);}));
 await c.send('Tracing.start',{categories:'devtools.timeline,v8,disabled-by-default-v8.gc',transferMode:'ReturnAsStream'});
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['desktop/reports/svd-fps-20261015/measure.mjs'],{windowsHide:true,stdio:'inherit',
   env:{...process.env,SVD_LABEL:'zoom-diagnostic',SVD_GESTURES:'zoom',SVD_PROFILE:'1',SVD_GPU:'0',SVD_ZOOM_FACTOR:'1'}});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Zoom diagnosis exited ${code}`)));
 });
 await c.send('Tracing.end');const stream=await complete;let trace='';
 for(;;){const r=await c.send('IO.read',{handle:stream,size:1024*1024});trace+=r.base64Encoded?Buffer.from(r.data,'base64').toString():r.data;if(r.eof)break;}
 await c.send('IO.close',{handle:stream});await writeFile(`${dir}/zoom-diagnostic.trace.json`,trace);
 const events=JSON.parse(trace).traceEvents;
 const gc=events.filter(e=>e.ph==='X'&&e.dur>1000&&/GC|GarbageCollect/.test(e.name)).map(e=>({name:e.name,durationMs:e.dur/1000,ts:e.ts,pid:e.pid,tid:e.tid}));
 const longest=events.filter(e=>e.ph==='X'&&e.dur>50000).sort((a,b)=>b.dur-a.dur).slice(0,30).map(e=>({name:e.name,durationMs:e.dur/1000,args:e.args,pid:e.pid,tid:e.tid}));
 const profile=JSON.parse(await readFile(`${dir}/zoom-diagnostic.cpuprofile`,'utf8'));
 const names=new Map(profile.nodes.map(n=>[n.id,n.callFrame.functionName]));
 const self={};for(let i=0;i<profile.samples.length;i++){const name=names.get(profile.samples[i]);self[name]=(self[name]??0)+(profile.timeDeltas?.[i]??0)/1000;}
 const summary={gc,longest,profileSelfMs:Object.entries(self).sort((a,b)=>b[1]-a[1]).slice(0,30)};
 await writeFile(`${dir}/zoom-diagnostic-summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{c.close();}
