from pathlib import Path
from collections import Counter
import json,numpy as np,subprocess,ifcopenshell,time
root=Path(__file__).resolve().parent
source=root/'host-198892.ifc';initial=ifcopenshell.open(source)
allids=[r.RelatedOpeningElement.id() for r in initial[198892].HasOpenings]
start=[198896,198912,198916,198936,198940,198956,198960]
rows=json.loads((root/'host-198892-ddmin-summary.json').read_text())
cache={tuple(row['ids']):row['failed']for row in rows};calls=len(rows)

def fails(ids):
    global calls
    key=tuple(ids)
    if key in cache:return cache[key]
    if calls>=40:raise RuntimeError('bounded 40-probe delta-minimization complete')
    calls+=1;label=f'ddmin-{calls:02}';f=ifcopenshell.open(source)
    for rel in list(f[198892].HasOpenings):
        if rel.RelatedOpeningElement.id()not in ids:f.remove(rel)
    path=root/f'host-198892-{label}.ifc';f.write(path);out=path.with_suffix('.json')
    before=time.monotonic();result=subprocess.run([str(root/'198892-probe-snapshot.exe'),str(path),'198892',str(out)],capture_output=True,text=True)
    out.with_suffix('.log').write_text(result.stdout+result.stderr)
    if result.returncode:raise RuntimeError(f'probe {calls}: {result.returncode}')
    data=json.loads(out.read_text());mesh=next(m for m in data['meshes']if m['express_id']==198892);v=np.asarray(mesh['positions']).reshape(-1,3);t=np.asarray(mesh['indices']).reshape(-1,3);edges=Counter()
    for tri in t:
        for i in range(3):edges[tuple(v[tri[i]]),tuple(v[tri[(i+1)%3]])]+=1
    invalid=sum(max(0,n-edges[b,a])for(a,b),n in edges.items());bad=invalid>0
    row={'label':label,'ids':ids,'count':len(ids),'unpairedDirectedEdges':invalid,'triangles':len(t),'seconds':time.monotonic()-before,'failed':bad};rows.append(row);cache[key]=bad
    (root/'host-198892-ddmin-summary.json').write_text(json.dumps(rows,indent=2));print(json.dumps(row),flush=True)
    return bad

candidate=start;n=2
try:
    assert fails(candidate)
    while len(candidate)>=2:
        partitions=[candidate[i*len(candidate)//n:(i+1)*len(candidate)//n]for i in range(n)]
        changed=False
        for subset in partitions:
            if fails(subset):candidate=subset;n=max(2,n-1);changed=True;break
        if changed:continue
        for subset in partitions:
            complement=[i for i in candidate if i not in subset]
            if fails(complement):candidate=complement;n=max(2,n-1);changed=True;break
        if changed:continue
        if n>=len(candidate):break
        n=min(len(candidate),n*2)
except RuntimeError as error:print(str(error),flush=True)
print('MINIMIZED',candidate,flush=True)
(root/'host-198892-ddmin-result.json').write_text(json.dumps({'ids':candidate,'probes':calls,'frozenProbeSha256':'25D0EA06B1A1227BBB6949E2BED641071D33BC08E540E4BB56D2C5767611C4B7'},indent=2))
