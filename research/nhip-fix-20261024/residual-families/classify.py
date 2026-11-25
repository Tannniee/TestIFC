from pathlib import Path
import ifcopenshell,ifcopenshell.geom,ifcopenshell.util.placement as pl,numpy as np,json,re,time,hashlib
P=Path(__file__).resolve().parent;source=Path(r'F:\Working\IFC Temp\Nhip chinh.ifc');f=ifcopenshell.open(source)
ids=[490757,492125,950227,178955,184047,257768,281338,282476,282590]

def walk_item(item,m,out):
 if item.is_a('IfcExtrudedAreaSolid'):
  sm=m@pl.get_axis2placement(item.Position);direction=np.array(item.ExtrudedDirection.DirectionRatios);axis=sm[:3,:3]@direction;axis/=np.linalg.norm(axis)
  out.append({'id':item.id(),'type':item.is_a(),'matrix':sm.tolist(),'axis':axis.tolist(),'depthFile':float(item.Depth),'profile':str(item.SweptArea),'profileId':item.SweptArea.id()})
 elif item.is_a('IfcMappedItem'):
  mm=m@pl.get_mappeditem_transformation(item)
  for sub in item.MappingSource.MappedRepresentation.Items:walk_item(sub,mm,out)
 elif item.is_a('IfcBooleanResult'):
  out.append({'id':item.id(),'type':item.is_a(),'operator':item.Operator})
  walk_item(item.FirstOperand,m,out);walk_item(item.SecondOperand,m,out)
 else:out.append({'id':item.id(),'type':item.is_a(),'record':str(item)[:300]})

def geometry(e):
 m=pl.get_local_placement(e.ObjectPlacement) if e.ObjectPlacement else np.eye(4);parts=[]
 for rep in e.Representation.Representations if e.Representation else []:
  if rep.RepresentationIdentifier not in ['Body','Reference']:continue
  for item in rep.Items:walk_item(item,m,parts)
 return parts

rows=[]
for i in ids:
 e=f[i];host=geometry(e);ax=[x['axis'] for x in host if 'axis'in x];cuts=[]
 for rel in e.HasOpenings:
  o=rel.RelatedOpeningElement;parts=geometry(o)
  for part in parts:
   if 'axis'in part and ax:part['hostAxisAbsDot']=abs(float(np.dot(ax[0],part['axis'])))
  cuts.append({'id':o.id(),'record':str(o),'representations':[(r.RepresentationIdentifier,r.RepresentationType) for r in o.Representation.Representations],'parts':parts})
 r={'id':i,'type':e.is_a(),'record':str(e),'host':host,'cuts':cuts};rows.append(r)
 print(json.dumps({'id':i,'type':e.is_a(),'host':[{'id':a['id'],'type':a['type'],'axis':a.get('axis'),'depthFile':a.get('depthFile'),'profile':a.get('profile')} for a in host],'cutCount':len(cuts),'cuts':[{'id':c['id'],'parts':[{'type':a['type'],'axis':a.get('axis'),'depthFile':a.get('depthFile'),'hostDot':a.get('hostAxisAbsDot'),'profile':a.get('profile')}for a in c['parts']]}for c in cuts]}),flush=True)
(P/'geometry-classification.json').write_text(json.dumps(rows,indent=2))
# Forward dependency closure plus inverse styling only; no geometry/class substitution.
for family,i in [('plate',490757),('footing',178955),('member',281338)]:
 roots=list(f.by_type('IfcProject'))+list(f.by_type('IfcSite'))+list(f.by_type('IfcBuilding'))+list(f.by_type('IfcBuildingStorey'))+[f[i]]+list(f[i].HasOpenings)
 selected={n.id() for r in roots for n in f.traverse(r) if n.id()};styles=[s for s in f.by_type('IfcStyledItem') if s.Item and s.Item.id()in selected];selected.update(n.id()for r in styles for n in f.traverse(r)if n.id());content=[]
 for l in source.read_bytes().splitlines(keepends=True):
  mt=re.match(rb'#(\d+)\s*=',l)
  if not mt or int(mt[1])in selected:content.append(l)
 b=b''.join(content);target=P/f'{family}-{i}.ifc';target.write_bytes(b);print('MINIMAL',family,i,len(selected),len(b),flush=True)
