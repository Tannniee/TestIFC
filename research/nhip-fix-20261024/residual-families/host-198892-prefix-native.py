from pathlib import Path
from collections import Counter
import json,numpy as np,subprocess,os
root=Path(__file__).resolve().parent
oracle={r['count']:r for r in json.loads((root/'host-198892-prefix-oracle.json').read_text())}
rows=[]
for count in [0,1,2,4,8,12,16,17]:
    target=root/f'host-198892-prefix-{count}.json'
    env=dict(os.environ);env['IFC_LITE_RESEARCH_ID']='198892'
    result=subprocess.run([str(root/'198892-probe-snapshot.exe'),str(root/f'host-198892-prefix-{count}.ifc'),'198892',str(target)],capture_output=True,text=True,env=env)
    target.with_suffix('.log').write_text(result.stdout+result.stderr)
    if result.returncode:print('FAIL',count,result.returncode,flush=True);continue
    data=json.loads(target.read_text());mesh=next(m for m in data['meshes']if m['express_id']==198892)
    v=np.asarray(mesh['positions']).reshape(-1,3);t=np.asarray(mesh['indices']).reshape(-1,3);center=v.mean(0);a,b,c=(v[t[:,i]]-center for i in range(3));volume=float(abs(np.einsum('ij,ij->i',a,np.cross(b,c)).sum()/6));edges=Counter()
    for tri in t:
        for i in range(3):edges[tuple(v[tri[i]]),tuple(v[tri[(i+1)%3]])]+=1
    unmatched=sum(max(0,n-edges[b,a])for(a,b),n in edges.items())
    row={'count':count,'triangles':len(t),'volume':volume,'oracleVolume':oracle[count]['volume'],'unpairedDirectedEdges':unmatched,'stats':data['stats']};rows.append(row)
    print(json.dumps({k:v for k,v in row.items()if k!='stats'}),flush=True)
(root/'host-198892-prefix-native-summary.json').write_text(json.dumps(rows,indent=2))
