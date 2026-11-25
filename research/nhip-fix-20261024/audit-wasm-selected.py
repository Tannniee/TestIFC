from pathlib import Path
import json, sys, numpy as np

path=Path(sys.argv[1])
data=json.loads(path.read_text())
rows=[]
for mesh in data['meshes']:
    points=np.asarray(mesh['positions'],dtype=np.float32).reshape(-1,3)
    points[points==0]=0
    triangles=np.asarray(mesh['indices'],dtype=np.int64).reshape(-1,3)
    _,mapping=np.unique(points,axis=0,return_inverse=True)
    t=mapping[triangles]
    directed=np.concatenate((t[:,[0,1]],t[:,[1,2]],t[:,[2,0]]))
    signs=np.where(directed[:,0]<directed[:,1],1,-1)
    _,inverse,counts=np.unique(np.sort(directed,axis=1),axis=0,return_inverse=True,return_counts=True)
    balances=np.bincount(inverse,weights=signs)
    p=points[triangles].astype(np.float64)
    cross=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0])
    centered=points.astype(np.float64)-points.astype(np.float64).mean(axis=0)
    q=centered[triangles]
    volume=abs(np.einsum('ij,ij->i',q[:,0],np.cross(q[:,1],q[:,2])).sum()/6)
    row={'id':mesh['id'],'triangles':len(t),'badEdges':int(np.count_nonzero(counts!=2)),
         'directedMismatch':int(np.count_nonzero(balances)),
         'collapsedTriangles':int(np.count_nonzero(np.all(cross==0,axis=1))), 'volumeM3':float(volume)}
    rows.append(row)
out=path.with_name(path.stem+'-topology.json')
out.write_text(json.dumps({'wasmSha256':data['sha256'],'meshes':rows},indent=2))
bad=[row for row in rows if any(row[key] for key in ('badEdges','directedMismatch','collapsedTriangles'))]
member=next(row for row in rows if row['id']==286665)
print(json.dumps({'meshes':len(rows),'topologyBad':bad,'member286665Volume':member['volumeM3']}))
assert not bad,bad
assert abs(member['volumeM3']-0.09050675564233114)<2e-6,member
