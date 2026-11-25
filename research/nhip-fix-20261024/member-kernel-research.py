from pathlib import Path
import ifcopenshell, ifcopenshell.geom, ifcopenshell.util.placement as pl
import json, numpy as np, re
P=Path(__file__).parent/'member-kernel';P.mkdir(exist_ok=True)
f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc');e=f[473164]
solid=next(x for r in e.Representation.Representations if r.RepresentationIdentifier=='Body' for x in r.Items)
frame=pl.get_local_placement(e.ObjectPlacement)@pl.get_axis2placement(solid.Position);inv=np.linalg.inv(frame)
roots=f.by_type('IfcProject')+f.by_type('IfcSite')+f.by_type('IfcBuilding')+f.by_type('IfcBuildingStorey')+[e]+list(e.HasOpenings)
ids={x.id() for r in roots for x in f.traverse(r) if x.id()}
source=Path(r'F:\Working\IFC Temp\Nhip chinh.ifc').read_bytes();body=[]
for line in source.splitlines(keepends=True):
 m=re.match(rb'#(\d+)\s*=',line)
 if not m or int(m[1])in ids:body.append(line)
(P/'plate-473164.ifc').write_bytes(b''.join(body))
rows=[]
for product in [e]+[r.RelatedOpeningElement for r in e.HasOpenings]:
 settings=ifcopenshell.geom.settings();settings.set('use-world-coords',True)
 if product==e:settings.set('disable-opening-subtractions',True)
 shape=ifcopenshell.geom.create_shape(settings,product);v=np.array(shape.geometry.verts).reshape(-1,3);t=np.array(shape.geometry.faces).reshape(-1,3)
 local=(np.c_[v*1000,np.ones(len(v))]@inv.T)[:,:3]/1000
 center=local.mean(0);a,b,c=(local[t[:,i]]-center for i in range(3));volume=abs(np.einsum('ij,ij->i',a,np.cross(b,c)).sum()/6)
 row={'id':product.id(),'name':product.Name,'type':product.is_a(),'bounds':[local.min(0).tolist(),local.max(0).tolist()],'triangles':len(t),'volume':volume}
 rows.append(row)
 (P/f'{product.id()}-oracle.json').write_text(json.dumps({'vertices':local.tolist(),'indices':t.tolist()}),encoding='utf-8')
settings=ifcopenshell.geom.settings();settings.set('use-world-coords',True)
shape=ifcopenshell.geom.create_shape(settings,e);v=np.array(shape.geometry.verts).reshape(-1,3);t=np.array(shape.geometry.faces).reshape(-1,3)
v=(np.c_[v*1000,np.ones(len(v))]@inv.T)[:,:3]/1000
(P/'cut-oracle.json').write_text(json.dumps({'vertices':v.tolist(),'indices':t.tolist()}),encoding='utf-8')
(P/'structure.json').write_text(json.dumps({'frame':frame.tolist(),'items':rows},indent=2),encoding='utf-8')
print(json.dumps(rows,indent=2))
