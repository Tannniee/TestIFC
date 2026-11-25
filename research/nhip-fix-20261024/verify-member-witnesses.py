from pathlib import Path
import json,ast,numpy as np,sys
p=Path(__file__).parent;h=ast.parse(Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024\compare-oracle.py').read_text())
exec(compile(ast.Module(body=[n for n in h.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helper>','exec'))
d=json.loads((p/sys.argv[1]).read_text());m=next(x for x in d['meshes']if x['express_id']==281338)
frame=np.asarray(json.loads((p/'residual-families'/'member-281338-frame.json').read_text()));rot=np.linalg.inv(frame[:3,:3]);origin=frame[:3,3]/1000
v=(world_native(d,m)-origin)@rot.T;t=np.asarray(m['indices']).reshape(-1,3)
o=json.loads((p/'oracle-281338.json').read_text());ov=(np.asarray(o['vertices']).reshape(-1,3)-origin)@rot.T;ot=np.asarray(o['indices']).reshape(-1,3)
def hits(v,t,y,z):
 a,b,c=v[t[:,0]],v[t[:,1]],v[t[:,2]];ab=b[:,1:]-a[:,1:];ac=c[:,1:]-a[:,1:];ap=np.array([y,z])-a[:,1:]
 det=ab[:,0]*ac[:,1]-ab[:,1]*ac[:,0];safe=np.where(abs(det)>1e-20,det,1)
 u=(ap[:,0]*ac[:,1]-ap[:,1]*ac[:,0])/safe;w=(ab[:,0]*ap[:,1]-ab[:,1]*ap[:,0])/safe
 valid=(abs(det)>1e-20)&(u>=-1e-9)&(w>=-1e-9)&(u+w<=1+1e-9);xs=a[:,0]+u*(b[:,0]-a[:,0])+w*(c[:,0]-a[:,0]);return sorted(set(round(float(x),8)for x in xs[valid]))
rows=[]
for y,z in [(1.46,-.02),(1.46,-3.98),(1.46,-.08),(1.46,-3.916),(-1.46,-.02),(0.,-2.)]:
 row={'stockPointYZ':[y,z],'actualIntersectionsX':hits(v,t,y,z),'oracleIntersectionsX':hits(ov,ot,y,z)};rows.append(row);print(json.dumps(row),flush=True)
for row in rows[:2]:assert row['actualIntersectionsX']==[] and row['oracleIntersectionsX']==[],row
(p/Path(sys.argv[1]).with_suffix('.witnesses.json')).write_text(json.dumps(rows,indent=2))
