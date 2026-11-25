from pathlib import Path
from collections import Counter
import json,numpy as np,subprocess,os,ifcopenshell
root=Path(__file__).resolve().parent
full=ifcopenshell.open(root/'host-198892.ifc');allids=[r.RelatedOpeningElement.id()for r in full[198892].HasOpenings]
cases={'drop-first':[i for i in allids if i!=198896],'drop-first-rc150':[i for i in allids if i!=198900],
       'last-only':[198960],'first-plus-last':[198896,198960],'drop-third-d70':[i for i in allids if i!=198956]}
cases={'drop-two-rc150':[i for i in allids if i not in [198900,198904]],
       'drop-three-rc150':[i for i in allids if i not in [198900,198904,198908]],
       'first-plus-four-d70':[198896,198948,198952,198956,198960]}
rows=[]
for name,ids in cases.items():
    f=ifcopenshell.open(root/'host-198892.ifc')
    for rel in list(f[198892].HasOpenings):
        if rel.RelatedOpeningElement.id()not in ids:f.remove(rel)
    path=root/f'host-198892-{name}.ifc';f.write(path);target=path.with_suffix('.json')
    env=dict(os.environ);env['IFC_LITE_RESEARCH_ID']='198892'
    result=subprocess.run([str(root/'198892-probe-snapshot.exe'),str(path),'198892',str(target)],capture_output=True,text=True,env=env)
    target.with_suffix('.log').write_text(result.stdout+result.stderr)
    if result.returncode:print('FAIL',name,result.returncode,flush=True);continue
    data=json.loads(target.read_text());mesh=next(m for m in data['meshes']if m['express_id']==198892);v=np.asarray(mesh['positions']).reshape(-1,3);t=np.asarray(mesh['indices']).reshape(-1,3);edges=Counter()
    for tri in t:
        for j in range(3):edges[tuple(v[tri[j]]),tuple(v[tri[(j+1)%3]])]+=1
    unmatched=sum(max(0,n-edges[b,a])for(a,b),n in edges.items())
    row={'label':name,'count':len(ids),'ids':ids,'triangles':len(t),'unpairedDirectedEdges':unmatched,'origin':mesh.get('origin',[0,0,0]),'stats':data['stats']};rows.append(row)
    print(json.dumps({k:v for k,v in row.items()if k not in ['stats','ids']}),flush=True)
(root/'host-198892-count-controls-small.json').write_text(json.dumps(rows,indent=2))
