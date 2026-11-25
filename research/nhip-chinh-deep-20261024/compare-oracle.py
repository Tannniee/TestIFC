import json,numpy as np
from pathlib import Path
p=Path(__file__).resolve().parent

def stats(v,t):
 t=np.asarray(t,dtype=int).reshape(-1,3);v=np.asarray(v);center=v.mean(axis=0);a,b,c=(v[t[:,i]]-center for i in range(3))
 return {'vertices':len(v),'triangles':len(t),'volume':float(abs(np.einsum('ij,ij->i',a,np.cross(b,c)).sum()/6)),'area':float(np.linalg.norm(np.cross(b-a,c-a),axis=1).sum()/2)}

def world_native(data,m):
 v=np.asarray(m['positions']).reshape(-1,3)+m.get('origin',[0,0,0]);R=np.array(data['siteTransform']).reshape(4,4,order='F')[:3,:3];return v@R.T+data['metadata']['coordinate_info']['origin_shift']

def sample(v,t):
 v=np.asarray(v);t=np.asarray(t,dtype=int).reshape(-1,3);tri=v[t]
 return np.concatenate((v,tri.mean(axis=1),tri[:,0]*.6+tri[:,1]*.2+tri[:,2]*.2,tri[:,0]*.2+tri[:,1]*.6+tri[:,2]*.2,tri[:,0]*.2+tri[:,1]*.2+tri[:,2]*.6))

def distances(points,verts,indices):
 tri=np.asarray(verts)[np.asarray(indices,dtype=int).reshape(-1,3)];a,b,c=(tri[:,i] for i in range(3));ab=b-a;ac=c-a;n=np.cross(ab,ac);nn=np.einsum('ij,ij->i',n,n);norm=n/np.sqrt(np.maximum(nn,1e-40))[:,None];d00=np.einsum('ij,ij->i',ab,ab);d01=np.einsum('ij,ij->i',ab,ac);d11=np.einsum('ij,ij->i',ac,ac);den=d00*d11-d01*d01;res=[]
 for start in range(0,len(points),24):
  q=points[start:start+24];ap=q[:,None,:]-a;sd=np.einsum('qij,ij->qi',ap,norm);d20=np.einsum('qij,ij->qi',ap,ab);d21=np.einsum('qij,ij->qi',ap,ac);safe=np.where(abs(den)>1e-35,den,1.);u=(d11*d20-d01*d21)/safe;w=(d00*d21-d01*d20)/safe;inside=(u>=-1e-9)&(w>=-1e-9)&(u+w<=1.+1e-9)&(abs(den)>1e-35)
  best=np.where(inside,sd*sd,np.inf)
  for e0,e1 in [(a,b),(b,c),(c,a)]:
   edge=e1-e0;length=np.einsum('ij,ij->i',edge,edge);qv=q[:,None,:]-e0;t=np.clip(np.einsum('qij,ij->qi',qv,edge)/np.maximum(length,1e-40),0,1);dv=qv-t[:,:,None]*edge;best=np.minimum(best,np.einsum('qij,qij->qi',dv,dv))
  res.extend(np.sqrt(np.min(best,axis=1)))
 return np.asarray(res)

oracle=json.loads((p/'oracle-reference-and-body-hosts.json').read_text())['rows'];byid={r['id']:r for r in oracle if 'vertices' in r}
cohorts=[('native-current-reference','native-minimal-original.json'),('native-semantic-class-control','native-minimal-control.json'),('native-current-body','native-body-hosts.json')];rows=[]
for label,file in cohorts:
 data=json.loads((p/file).read_text());
 for m in data['meshes']:
  i=m['express_id']
  if i not in byid:continue
  o=byid[i];v=world_native(data,m);t=np.asarray(m['indices']).reshape(-1,3);ov=np.asarray(o['vertices']);ot=np.asarray(o['indices']);center=ov.mean(axis=0);a=distances(sample(v,t)-center,ov-center,ot);b=distances(sample(ov,ot)-center,v-center,t);s=stats(v,t);os=stats(ov,ot);r={'cohort':label,'id':i,'referenceOnly':o['referenceOnly'],'native':s,'oracle':os,'maxBoundsDeltaMm':float(np.max(abs(np.array([v.min(axis=0),v.max(axis=0)])-np.array(o['bounds'])))*1000),'sampledMaxSurfaceDistanceMm':float(max(a.max(),b.max())*1000),'directedSampleCounts':[len(a),len(b)],'relativeVolumeErrorPercent':100*abs(s['volume']-os['volume'])/os['volume']}
  rows.append(r);print(json.dumps(r),flush=True)
(p/'geometry-oracle-comparison.json').write_text(json.dumps(rows,indent=2))
