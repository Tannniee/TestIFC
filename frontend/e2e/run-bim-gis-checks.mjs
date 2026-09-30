import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(frontend,'..');
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const cache=await mkdtemp(path.join(tmpdir(),'testifc-bim-gis-regression-'));
const env={...process.env,IFC_API_SESSION_TOKEN:randomBytes(32).toString('hex'),IFC_BRIDGE_URL:`http://127.0.0.1:${port}`,
  IFC_E2E_BASE_URL:'http://127.0.0.1:5173',IFC_E2E_BIM_FIXTURE:path.join(root,'test-fixtures/phase3-bim.ifc'),IFC_MODEL_CACHE_DIR:cache};
const host=spawn(path.join(root,'.venv/Scripts/python.exe'),['-m','uvicorn','app:app','--app-dir','src','--host','127.0.0.1','--port',String(port),'--log-level','warning'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
try {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){ if(host.exitCode!==null) throw new Error('Bridge failed');try{if((await fetch(`${env.IFC_BRIDGE_URL}/health`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200)); }
  const tests=spawn(process.execPath,[path.join(frontend,'node_modules/@playwright/test/cli.js'),'test','gis-3d.spec.ts','bim-properties.spec.ts','project-browser.spec.ts'],{cwd:frontend,env,windowsHide:true,stdio:'inherit'});
  const code=await new Promise(resolve=>tests.once('exit',resolve));if(code) process.exitCode=code;
} finally {host.kill();}
