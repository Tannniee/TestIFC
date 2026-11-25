from pathlib import Path
import ast,json,numpy as np,ifcopenshell,ifcopenshell.geom
out=Path(r'F:\Steel\VBA\IFC-Lite-Core104\research\nhip-fix-20261024');research=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024')
helpers=ast.parse((research/'compare-oracle.py').read_text());exec(compile(ast.Module(body=[n for n in helpers.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<geometry-helpers>','exec'))
f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc');oracle={}
for i in [2444,298390,303995,304217]:
 s=ifcopenshell.geom.settings();s.set('use-world-coords',True);shape=ifcopenshell.geom.create_shape(s,f.by_id(i));v=np.array(shape.geometry.verts).reshape(-1,3);t=np.array(shape.geometry.faces).reshape(-1,3);oracle[i]=(v,t)
results=[]
for file in ['branch-r2-remaining-body.json']:
 d=json.loads((out/file).read_text())
 for m in d['meshes']:
  i=m['express_id'];v=world_native(d,m);t=np.array(m['indices']).reshape(-1,3);ov,ot=oracle[i];center=ov.mean(0);a=distances(sample(v,t)-center,ov-center,ot);b=distances(sample(ov,ot)-center,v-center,t);n=stats(v,t);o=stats(ov,ot)
  r={'input':file,'id':i,'native':n,'oracle':o,'sampledMaxSurfaceDistanceMm':float(max(a.max(),b.max())*1000),'maxBoundsDeltaMm':float(abs(np.array([v.min(0),v.max(0)])-np.array([ov.min(0),ov.max(0)])).max()*1000),'relativeVolumeErrorPercent':abs(n['volume']-o['volume'])/o['volume']*100};results.append(r);print(json.dumps(r),flush=True)
(out/'branch-r2-remaining-body-oracle.json').write_text(json.dumps(results,indent=2))
