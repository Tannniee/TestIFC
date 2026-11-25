import json,numpy as np
from pathlib import Path
p=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024');n=json.loads((p/'native-first-hosts.json').read_text());w=json.loads((p/'wasm-first-hosts.json').read_text());o=json.loads((p/'oracle-first-hosts.json').read_text());R=np.array(n['siteTransform']).reshape(4,4,order='F');shift=np.array(n['metadata']['coordinate_info']['origin_shift']);rows=[]
def stats(v,t):
 v=np.array(v);t=np.array(t,dtype=int).reshape(-1,3);a,b,c=(v[t[:,i]]-v.mean(axis=0) for i in range(3));volume=abs(np.einsum('ij,ij->i',a,np.cross(b,c)).sum()/6);area=np.linalg.norm(np.cross(b-a,c-a),axis=1).sum()/2
 return {'triangles':len(t),'vertices':len(v),'bounds':[v.min(axis=0).tolist(),v.max(axis=0).tolist()],'volumeStable':float(volume),'area':float(area)}
for m in n['meshes']:
 v=np.array(m['positions']).reshape(-1,3)+m.get('origin',[0,0,0]);v=v@R[:3,:3].T+shift
 rows.append({'engine':'native','id':m['express_id'],**stats(v,m['indices'])})
for m in w['meshes']:
 v=np.array(m['positions']).reshape(-1,3)+m.get('origin',[0,0,0]);v=np.column_stack((v[:,0],-v[:,2],v[:,1]))+w['preRtcIfc']
 rows.append({'engine':'wasm','id':m['id'],**stats(v,m['indices'])})
for m in o['rows']:
 if 'vertices' in m: rows.append({'engine':'oracle','id':m['id'],'cut':m['cut'],**stats(m['vertices'],m['indices'])})
(p/'first-hosts-metrics.json').write_text(json.dumps(rows,indent=2))
for i in [434,820,463,855,2391]:
 print('ID',i)
 for r in rows:
  if r['id']==i:print(json.dumps({k:v for k,v in r.items() if k!='bounds'}))
