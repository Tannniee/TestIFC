import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
const env={...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'};
const credential=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env,stdio:['pipe','pipe','pipe']});
const password=credential.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);
if(!password) throw new Error('No authenticated GitHub credential available');
const base='https://api.github.com/repos/Tannniee/TestIFC';
async function request(path,method='GET',body){
 const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${password}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${r.status}`);
 return r.status===204?null:await r.json();
}
const mode=process.argv[2]??'inspect';
const repo=await request('');
const before=await request('/actions/permissions');
if(mode==='disable'&&before.enabled) await request('/actions/permissions','PUT',{enabled:false});
const permissions=await request('/actions/permissions');
const rulesets=await request('/rulesets');
const runs=await request('/actions/runs?per_page=20');
const result={at:new Date().toISOString(),mode,repo:repo.full_name,default_branch:repo.default_branch,admin:repo.permissions?.admin,before,permissions,rulesets:rulesets.map(x=>({id:x.id,name:x.name,enforcement:x.enforcement})),totalRuns:runs.total_count,runs:runs.workflow_runs.map(x=>({id:x.id,head_sha:x.head_sha,status:x.status,conclusion:x.conclusion,event:x.event,created_at:x.created_at}))};
if(mode==='verify'){
 const prepared=JSON.parse(readFileSync(new URL('prepared.json',import.meta.url),'utf8'));
 const fixed=existsSync(new URL('automation-fixed.json',import.meta.url))?JSON.parse(readFileSync(new URL('automation-fixed.json',import.meta.url),'utf8')):null;
 const expectedMain=fixed?.commit??prepared.commit;
 const expectedTree=fixed?.tree??prepared.tree;
 const [main,tagRef,commit,runsForCommit]=await Promise.all([
  request('/git/ref/heads/main'),request('/git/ref/tags/v2.0.1'),request('/git/commits/'+expectedMain),request('/actions/runs?head_sha='+prepared.commit+'&per_page=100')
 ]);
 const tag=await request('/git/tags/'+tagRef.object.sha);
 const remoteTree=await request('/git/trees/'+commit.tree.sha+'?recursive=1');
 const files=remoteTree.tree.filter(x=>x.type==='blob');
 const active=files.filter(x=>x.path.startsWith('.github/workflows/'));
 const archived=files.filter(x=>x.path.startsWith('.github/workflows-disabled/')&&x.path.endsWith('.disabled'));
 result.publication={main:main.object.sha,tagObject:tagRef.object.sha,tagCommit:tag.object.sha,tree:commit.tree.sha,parent:commit.parents.map(x=>x.sha),fileCount:files.length,treeTruncated:remoteTree.truncated,activeWorkflows:active.length,archivedWorkflows:archived.length,commitActionRuns:runsForCommit.total_count,commitRunDetails:runsForCommit.workflow_runs.map(x=>({id:x.id,name:x.name,head_sha:x.head_sha,status:x.status,conclusion:x.conclusion,event:x.event,created_at:x.created_at,run_started_at:x.run_started_at,path:x.path})),oldTag:(await request('/git/ref/tags/v2.0.0')).object.sha};
 writeFileSync(new URL('github-verify-observed.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result.publication));
 const liveRuns=runs.workflow_runs.filter(x=>x.created_at>='2026-10-20T02:36:52Z'&&x.status!=='completed');
 const unexpectedRuns=runs.workflow_runs.filter(x=>x.created_at>='2026-10-20T02:36:52Z'&&x.path!=='dynamic/dependabot/dependabot-updates');
 result.publication.activeRuns=liveRuns.length;
 result.publication.nonDependabotRuns=unexpectedRuns.length;
 result.publication.activeDependabotConfig=files.some(x=>x.path==='.github/dependabot.yml'||x.path==='.github/dependabot.yaml');
 result.publication.openRecentBotPRs=(await request('/pulls?state=open&sort=created&direction=desc&per_page=100')).filter(x=>x.created_at>='2026-10-20T02:36:52Z'&&x.user?.login==='dependabot[bot]').map(x=>({number:x.number,title:x.title,url:x.html_url}));
 if(permissions.enabled||main.object.sha!==expectedMain||tag.object.sha!==prepared.commit||commit.tree.sha!==expectedTree||commit.parents[0]?.sha!==(fixed?.parent??prepared.parent)||remoteTree.truncated||files.length!==prepared.fileCount||active.length||archived.length!==prepared.archivedWorkflows||liveRuns.length||unexpectedRuns.length||result.publication.activeDependabotConfig) throw Error('Remote publication verification failed');
}
writeFileSync(new URL(`github-${mode}.json`,import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
