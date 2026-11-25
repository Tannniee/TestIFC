from pathlib import Path
import numpy as np,ifcopenshell,ifcopenshell.util.placement as pl
f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc')
for i in [473164,473277,473789,473865,471627,473024,473532,286665]:
 e=f[i]
 def solids(p):
  for r in p.Representation.Representations:
   if r.RepresentationIdentifier!='Body':continue
   for s in r.Items:
    if not s.is_a('IfcExtrudedAreaSolid'):continue
    m=pl.get_local_placement(p.ObjectPlacement)@pl.get_axis2placement(s.Position);d=m[:3,:3]@np.asarray(s.ExtrudedDirection.DirectionRatios);d/=np.linalg.norm(d)
    yield s,m,d
 h,hm,hd=next(solids(e));rows=[]
 for rel in sorted(e.HasOpenings,key=lambda r:r.RelatedOpeningElement.id()):
  o=rel.RelatedOpeningElement
  for s,m,d in solids(o):rows.append((o.id(),s.SweptArea.is_a(),float(s.Depth),float(np.linalg.norm(np.cross(d,hd))*s.Depth*1000)))
 print(i,'host',h.SweptArea.is_a(),h.Depth,'opening lateral drift um',rows,flush=True)
