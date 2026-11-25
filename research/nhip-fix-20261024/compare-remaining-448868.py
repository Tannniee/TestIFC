from pathlib import Path
import json,ast,numpy as np
p=Path(r'F:\Steel\VBA\IFC-Lite-Core104\research\nhip-fix-20261024');research=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024');helpers=ast.parse((research/'compare-oracle.py').read_text());exec(compile(ast.Module(body=[n for n in helpers.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'));oracle={r['id']:r for r in json.loads((p/'remaining-plate-448868/oracle.json').read_text())};rows=[]
for name in ['remaining-448868-full.json','remaining-448868-local.json']:
 d=json.loads((p/name).read_text())
 for m in d['meshes']:
  v=world_native(d,m);t=np.array(m['indices']).reshape(-1,3);o=oracle[m['express_id']];ov=np.array(o['vertices']);ot=np.array(o['indices']);c=ov.mean(0);a=distances(sample(v,t)-c,ov-c,ot);b=distances(sample(ov,ot)-c,v-c,t);n=stats(v,t);os=stats(ov,ot);r={'input':name,'id':m['express_id'],'native':n,'oracle':os,'sampledMaxDistanceMm':float(max(a.max(),b.max())*1000),'relativeVolumeErrorPercent':abs(n['volume']-os['volume'])/os['volume']*100,'maxBoundsDeltaMm':float(abs(np.array([v.min(0),v.max(0)])-np.array(o['bounds'])).max()*1000)};rows.append(r);print(json.dumps(r),flush=True)
(p/'remaining-448868-oracle-baseline.json').write_text(json.dumps(rows,indent=2))
