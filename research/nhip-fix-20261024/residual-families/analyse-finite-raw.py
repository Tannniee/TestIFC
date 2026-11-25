from pathlib import Path
from collections import defaultdict
import json,numpy as np
root=Path(__file__).resolve().parent

def census(v,t):
    edges=defaultdict(list)
    for ti,tri in enumerate(t):
        for k in range(3):
            a,b=tuple(v[tri[k]]),tuple(v[tri[(k+1)%3]])
            edges[tuple(sorted([a,b]))].append((ti,1 if a<b else-1))
    return {edge:uses for edge,uses in edges.items()if len(uses)!=2 or sum(s for _,s in uses)!=0}

def components(edges,scale):
    graph=defaultdict(set)
    for a,b in edges:graph[a].add(b);graph[b].add(a)
    seen=set();out=[]
    for start in graph:
        if start in seen:continue
        pending=[start];seen.add(start);nodes=[]
        while pending:
            current=pending.pop();nodes.append(current)
            for neighbor in graph[current]:
                if neighbor not in seen:seen.add(neighbor);pending.append(neighbor)
        points=np.asarray(nodes);d=points[:,None,:]-points[None,:,:];i,j=np.unravel_index(np.argmax(np.sum(d*d,axis=2)),d.shape[:2]);axis=points[j]-points[i];axislen=np.linalg.norm(axis)
        height=float(np.linalg.norm(np.cross(points-points[i],axis),axis=1).max()/axislen)if axislen else 0
        out.append({'vertices':len(nodes),'edges':sum(len(graph[x])for x in nodes)//2,'diameterMicrometres':float(axislen/scale*1e6),'heightMicrometres':height/scale*1e6,'collinearExact':bool(np.all(np.cross(points-points[i],axis)==0)), 'pointsMetres':(points/scale).tolist()})
    return out

def split_exact(v,t):
    t=t.tolist();splits=0
    for _ in range(100):
        bad=census(v,np.asarray(t));vertices={p for edge in bad for p in edge};found=False
        for (a,b),uses in bad.items():
            aa=np.asarray(a);bb=np.asarray(b);ab=bb-aa;length=float(np.dot(ab,ab))
            if not length:continue
            for pp in vertices:
                p=np.asarray(pp);ap=p-aa;dot=float(np.dot(ap,ab))
                if not(0<dot<length)or not np.all(np.cross(ap,ab)==0):continue
                index=next(i for i,x in enumerate(v)if tuple(x)==pp)
                for ti,_ in uses:
                    tri=t[ti]
                    for k in range(3):
                        e0,e1,third=tri[k],tri[(k+1)%3],tri[(k+2)%3]
                        if {tuple(v[e0]),tuple(v[e1])}=={a,b}:
                            t[ti]=[e0,index,third];t.append([index,e1,third]);splits+=1;break
                found=True;break
            if found:break
        if not found:break
    return np.asarray(t),splits

rows=[]
for path in sorted((root/'finite-raw').glob('nary-*.json')):
    if path.stem.endswith('-exact-split'):continue
    data=json.loads(path.read_text());scale=data['workScale'];v=np.asarray(data['collapsedOnly']['positions']).reshape(-1,3);t=np.asarray(data['collapsedOnly']['indices']).reshape(-1,3);bad=census(v,t);comp=components(bad,scale)
    revised,splits=split_exact(v,t);remaining=census(v,revised)
    p=v[revised];cross=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]);collapsed=int(np.sum(np.all(cross==0,axis=1)))
    def volume(indices):
        center=v.mean(0);a,b,c=(v[indices[:,i]]-center for i in range(3))
        return float(abs(np.einsum('ij,ij->i',a,np.cross(b,c)).sum()/6/scale**3))
    row={'file':path.name,'scale':scale,'collapsedOnlyBadEdges':len(bad),'components':comp,'exactSplits':splits,'remainingBadEdges':len(remaining),'remainingCollapsedTriangles':collapsed,'beforeVolumeM3':volume(t),'afterVolumeM3':volume(revised),'verticesMoved':0}
    rows.append(row);print(json.dumps({k:v for k,v in row.items()if k!='components'}),flush=True)
    path.with_name(path.stem+'-exact-split.json').write_text(json.dumps({'positions':v.reshape(-1).tolist(),'indices':revised.reshape(-1).tolist(),'workScale':scale}))
(root/'finite-raw-analysis.json').write_text(json.dumps(rows,indent=2))
