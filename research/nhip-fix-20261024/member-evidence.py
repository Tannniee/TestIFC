from pathlib import Path
import json, ast, numpy as np, ifcopenshell, ifcopenshell.geom
import ifcopenshell.util.placement as pl
P=Path(__file__).parent
helpers=ast.parse(Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024\compare-oracle.py').read_text(encoding='utf-8'))
exec(compile(ast.Module(body=[n for n in helpers.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'))
f=ifcopenshell.open(str(P/'residual-families/member-281338.ifc')); host=f[281338]
solid=next(x for r in host.Representation.Representations if r.RepresentationIdentifier=='Body' for x in r.Items)
frame=pl.get_local_placement(host.ObjectPlacement)@pl.get_axis2placement(solid.Position)
inverse=np.linalg.inv(frame)
def local(v): return (np.c_[v*1000,np.ones(len(v))]@inverse.T)[:,:3]/1000
oracle=json.loads((P/'oracle-281338.json').read_text(encoding='utf-8'))
ov=local(np.array(oracle['vertices']).reshape(-1,3));ot=np.array(oracle['indices']).reshape(-1,3)
def ray(v,t,y,z):
 a,b,c=(v[t[:,i]] for i in range(3)); e=b-a; g=c-a
 den=e[:,1]*g[:,2]-e[:,2]*g[:,1]; valid=np.abs(den)>1e-15
 den=np.where(valid,den,1); yy=y-a[:,1];zz=z-a[:,2]
 u=(yy*g[:,2]-zz*g[:,1])/den; w=(e[:,1]*zz-e[:,2]*yy)/den
 hits=a[:,0]+u*e[:,0]+w*g[:,0]
 return sorted(set(np.round(hits[valid&(u>1e-8)&(w>1e-8)&(u+w<1-1e-8)],8).tolist()))
meshes={}
for name in ['centered-frame-five.json','source-complete-five-hosts.json']:
 d=json.loads((P/name).read_text(encoding='utf-8'));m=next(m for m in d['meshes'] if m['express_id']==281338)
 v=local(world_native(d,m));t=np.array(m['indices']).reshape(-1,3);meshes[name]=(v,t)
 print(name,'volume',stats(v,t)['volume'],'tris',len(t))
d=json.loads((P/'residual-families/member-281338-host-frame.json').read_text(encoding='utf-8'));m=d['meshes'][0]
v=world_native(d,m);t=np.array(m['indices']).reshape(-1,3);meshes['normalized']=(v,t)
print('normalized','volume',stats(v,t)['volume'],'tris',len(t),'bounds',v.min(0).tolist(),v.max(0).tolist())
print('oracle volume',stats(ov,ot)['volume'],'bounds',ov.min(0).tolist(),ov.max(0).tolist())
rows=[]
for y in [-1.46,-1.44,-1.42,-1.4,-1.36,-1.3,-1.2,-1.,-.7,-.1,0.,.1,.7,1.,1.2,1.3,1.36,1.4,1.42,1.44,1.46]:
 for z in [-3.98,-3.96,-3.94,-3.9,-3.8,-3.6,-3.4,-3.,-2.5,-2.,-1.5,-1.,-.6,-.4,-.2,-.1,-.06,-.04,-.02]:
  expected=ray(ov,ot,y,z); got={name:ray(v,t,y,z)for name,(v,t)in meshes.items()}
  if any(bool(x)!=bool(expected)for x in got.values()):rows.append({'point':[y,z],'oracle':expected,**got})
print('differences',len(rows)); print(json.dumps(rows[:25],indent=2))
(P/'member-ray-evidence.json').write_text(json.dumps({'oracleVolume':stats(ov,ot)['volume'],'differences':rows},indent=2),encoding='utf-8')
