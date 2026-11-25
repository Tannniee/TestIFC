from pathlib import Path
import ast,json,numpy as np,ifcopenshell,ifcopenshell.geom
p=Path(__file__).parent;helpers=ast.parse(Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024\compare-oracle.py').read_text())
exec(compile(ast.Module(body=[n for n in helpers.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'))
d=json.loads((p/'metric-debug'/'cutter-490787.json').read_text());v=np.asarray(d['positions']).reshape(-1,3)+d['origin'];t=np.asarray(d['indices']).reshape(-1,3)
print('local bounds',v.min(0),v.max(0),'origin',d['origin'],flush=True)
frame=np.asarray(json.loads((p/'residual-families'/'plate-490757-frame.json').read_text()));v=v@frame[:3,:3].T+frame[:3,3]/1000
f=ifcopenshell.open(str(p/'residual-families'/'plate-490757.ifc'));s=ifcopenshell.geom.settings();s.set(s.USE_WORLD_COORDS,True);sh=ifcopenshell.geom.create_shape(s,f[490787]);ov=np.asarray(sh.geometry.verts).reshape(-1,3);ot=np.asarray(sh.geometry.faces).reshape(-1,3);center=ov.mean(0)
a=distances(sample(v,t)-center,ov-center,ot);b=distances(sample(ov,ot)-center,v-center,t)
print('cutter distances mm',a.max()*1000,b.max()*1000,'volumes',stats(v,t),stats(ov,ot),flush=True)
