import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),port=4182;
const session=randomBytes(32).toString('hex'),cache=await mkdtemp(path.join(tmpdir(),'testifc-panels-'));
const host=spawn(path.join(root,'.venv/Scripts/python.exe'),['-c',`import sys;sys.path[:0]=['src','desktop'];import uvicorn;from app import app;from fastapi.staticfiles import StaticFiles;app.mount('/',StaticFiles(directory='frontend/dist',html=True));uvicorn.run(app,host='127.0.0.1',port=${port},log_level='warning')`],{cwd:root,env:{...process.env,IFC_API_SESSION_TOKEN:session,IFC_MODEL_CACHE_DIR:cache},windowsHide:true,stdio:'ignore'});
let browser;const output=path.join(root,'reports/panels');await mkdir(output,{recursive:true});
try{
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript(session=>{window.pywebview={api:{get_api_session:async()=>({token:session}),load_settings:async()=>null,save_settings:async s=>s}};},session);
  await page.goto(`http://127.0.0.1:${port}/?viewerDebug=1`);
  await page.locator('.viewer-mount canvas').waitFor();
  if(process.env.IFC_PANEL_FIXTURE){await page.locator('input[type=file]').setInputFiles(process.env.IFC_PANEL_FIXTURE);await page.waitForFunction(()=>document.querySelector('.qn-status-bar')?.textContent.includes('Dữ liệu mô hình: sẵn sàng'),null,{timeout:120000});}
  await page.evaluate(()=>{window.__panelSamples=[];window.__panelFrames=[];new ResizeObserver(entries=>{for(const e of entries)window.__panelSamples.push({t:performance.now(),w:e.contentRect.width,h:e.contentRect.height});}).observe(document.querySelector('.viewer-mount'));});
  const results=[];
  for(const name of ['Project Browser','Mở/đóng bảng thuộc tính']){
    for(let n=0;n<3;n++){
      await page.evaluate(()=>{window.__panelSamples=[];window.__panelFrames=[];const until=performance.now()+900;let last=performance.now();const frame=t=>{window.__panelFrames.push(t-last);last=t;if(t<until)requestAnimationFrame(frame);};requestAnimationFrame(frame);});
      await page.getByRole('button',{name,exact:true}).first().click();
      await page.waitForTimeout(450);
      await page.getByRole('button',{name,exact:true}).first().click();
      await page.waitForTimeout(550);
      results.push(await page.evaluate(name=>({name,resizes:window.__panelSamples.length,widths:window.__panelSamples.map(s=>s.w),maxFrameMs:Math.max(...window.__panelFrames),framesOver50:window.__panelFrames.filter(t=>t>50).length}),name));
    }
  }
  console.log(JSON.stringify(results));await writeFile(path.join(output,`${process.argv[2]||'run'}.json`),JSON.stringify(results,null,2));
}finally{await browser?.close();host.kill();}
