import ifcopenshell,ifcopenshell.geom,numpy as np,json,time
from pathlib import Path
out=Path(__file__).resolve().parent;f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc');rows=[];hostids=set()
for i in [322462,344072,266657,269795,330807,64951,434,820]:
 e=f[i]; rels=[r for r in f.get_inverse(e) if r.is_a('IfcRelVoidsElement') and r.RelatedOpeningElement.id()==i];hosts=[r.RelatingBuildingElement.id() for r in rels];hostids.update(hosts)
 r={'id':i,'record':str(e),'hosts':hosts,'ownOpenings':len(e.HasOpenings)}
 if e.Representation:r['representations']=[{'id':rep.id(),'identifier':rep.RepresentationIdentifier,'type':rep.RepresentationType,'items':[{'id':it.id(),'type':it.is_a()} for it in rep.Items]} for rep in e.Representation.Representations]
 rows.append(r);print(json.dumps(r),flush=True)
for i in sorted(hostids):
 e=f[i];print('HOST',str(e),'CUTS',len(e.HasOpenings),flush=True)
(out/'large-features.json').write_text(json.dumps({'features':rows,'hostIds':sorted(hostids)},indent=2))
