import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const credential=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},stdio:['pipe','pipe','pipe']});
const token=credential.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);
const base='https://api.github.com/repos/Tannniee/TestIFC';
async function request(path,method='GET'){
 const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 return {status:r.status,data:r.status===204?null:await r.json()};
}
const runs=await request('/actions/runs?head_sha=375b5bfc3cacb3cffe4060deb919a02b44e34651&per_page=100');
const results=await Promise.all(runs.data.workflow_runs.filter(x=>x.status!=='completed').map(async x=>{
 const cancel=await request(`/actions/runs/${x.id}/cancel`,'POST');
 return {id:x.id,name:x.name,cancelStatus:cancel.status,...(cancel.status!==202?{forceStatus:(await request(`/actions/runs/${x.id}/force-cancel`,'POST')).status}:{})};
}));
writeFileSync(new URL('cancel-dependabot.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results));
