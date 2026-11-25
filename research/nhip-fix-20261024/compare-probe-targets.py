from pathlib import Path
from collections import Counter
import ast,json,sys,numpy as np,ifcopenshell,ifcopenshell.geom
root=Path(__file__).parent; helpers=ast.parse(Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024\compare-oracle.py').read_text())
exec(compile(ast.Module(body=[n for n in helpers.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'))
data=json.loads((root/sys.argv[1]).read_text()); model=None; result=[]
source=data['source']; custom=Path(source).resolve()!=Path(r'F:\Working\IFC Temp\Nhip chinh.ifc').resolve()
for mesh in data['meshes']:
 i=mesh['express_id']; cache=root/f'oracle-{i}{"-"+Path(source).stem if custom else ""}.json'
 if cache.exists():o=json.loads(cache.read_text())
 else:
  if model is None:model=ifcopenshell.open(source)
  settings=ifcopenshell.geom.settings();settings.set(settings.USE_WORLD_COORDS,True)
  shape=ifcopenshell.geom.create_shape(settings,model[i]);o={'vertices':list(shape.geometry.verts),'indices':list(shape.geometry.faces)};cache.write_text(json.dumps(o))
 v=world_native(data,mesh);t=np.asarray(mesh['indices']).reshape(-1,3);ov=np.asarray(o['vertices']).reshape(-1,3);ot=np.asarray(o['indices']).reshape(-1,3);center=ov.mean(0)
 a=distances(sample(v,t)-center,ov-center,ot);b=distances(sample(ov,ot)-center,v-center,t)
 s=stats(v,t);os=stats(ov,ot); edges=Counter(); pp=np.asarray(mesh['positions'],dtype=np.float32).reshape(-1,3)
 for tri in t:
  for x,y in zip(tri,np.roll(tri,-1)):edges[tuple(float(z) for z in pp[x]),tuple(float(z) for z in pp[y])]+=1
 row={'id':i,'triangles':len(t),'sampledMaxSurfaceDistanceMm':float(max(a.max(),b.max())*1000),'volumeErrorPercent':100*abs(s['volume']-os['volume'])/os['volume'],'volume':s['volume'],'oracleVolume':os['volume'],'unpairedDirectedEdges':sum(max(0,n-edges[b,a])for(a,b),n in edges.items())};result.append(row);print(json.dumps(row),flush=True)
(root/Path(sys.argv[1]).with_suffix('.oracle.json')).write_text(json.dumps(result,indent=2))
