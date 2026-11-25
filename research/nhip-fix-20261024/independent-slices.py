from pathlib import Path
import json,numpy as np,ifcopenshell,ifcopenshell.geom
from shapely.geometry import LineString
from shapely.ops import polygonize,unary_union
root=Path(__file__).parent
f=ifcopenshell.open(str(root/'residual-families'/'plate-490757.ifc'))
frame=np.asarray(json.loads((root/'residual-families'/'plate-490757-frame.json').read_text()));inv=np.linalg.inv(frame)
s=ifcopenshell.geom.settings();s.set(s.USE_WORLD_COORDS,True);s.set(s.DISABLE_OPENING_SUBTRACTIONS,True)
ids=[490757,490765,490771,490775,490779,490783,490787,490791];meshes=[]
for i in ids:
 shape=ifcopenshell.geom.create_shape(s,f[i]);v=np.asarray(shape.geometry.verts).reshape(-1,3)*1000
 v=(v-frame[:3,3])@inv[:3,:3].T/1000;t=np.asarray(shape.geometry.faces).reshape(-1,3);meshes.append((v,t))
 print(i,'bounds',v.min(0).tolist(),v.max(0).tolist(),flush=True)
def section(mesh,z):
 v,t=mesh;lines=[]
 for tri in v[t]:
  hits=[]
  for a,b in zip(tri,np.roll(tri,-1,axis=0)):
   if (a[2]-z)*(b[2]-z)<0:
    q=a+(b-a)*((z-a[2])/(b[2]-a[2]));hits.append(tuple(np.round(q[:2],9)))
  if len(set(hits))==2:lines.append(LineString(hits))
 rings=list(polygonize(unary_union(lines)))
 if not rings:raise RuntimeError(('no section',z))
 return unary_union(rings)
zlo,zhi=meshes[0][0][:,2].min(),meshes[0][0][:,2].max();rows=[]
for z in np.linspace(zlo+1e-7,zhi-1e-7,101):
 stock=section(meshes[0],z);areas=[stock.area]
 for cutter in meshes[1:]:stock=stock.difference(section(cutter,z));areas.append(stock.area)
 rows.append(areas)
vol=np.trapezoid(np.asarray(rows),dx=(zhi-zlo)/100,axis=0)
print('VOLUMES',vol.tolist(),flush=True)
(root/'independent-slices-490757.json').write_text(json.dumps({'ids':ids,'volumes':vol.tolist()},indent=2))
