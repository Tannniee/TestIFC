from pathlib import Path
import ifcopenshell,json,re
out=Path(__file__).resolve().parent/'body-repro';f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc');hostids=[2444];roots=list(f.by_type('IfcProject'))+list(f.by_type('IfcSite'))+list(f.by_type('IfcBuilding'))+list(f.by_type('IfcBuildingStorey'))
for i in hostids:
 e=f[i];roots.append(e);roots.extend(e.HasOpenings)
selected={n.id() for r in roots for n in f.traverse(r) if n.id()}
# Preserve the authored item styling; inverse style attachments are not reached by traverse.
styles=[s for s in f.by_type('IfcStyledItem') if s.Item and s.Item.id() in selected]
selected.update(n.id() for r in styles for n in f.traverse(r) if n.id())
raw=Path(r'F:\Working\IFC Temp\Nhip chinh.ifc').read_bytes();lines=raw.splitlines(keepends=True);data=False;content=[]
for l in lines:
 m=re.match(rb'#(\d+)\s*=',l)
 if not m or int(m[1]) in selected:content.append(l)
b=b''.join(content);(out/'minimal-original.ifc').write_bytes(b)
# This class substitution is a diagnostic control, never a user delivery.
changed=0;rows=[]
for l in content:
 if re.match(rb'#\d+\s*=\s*IFCVOIDINGFEATURE\(',l):
  l=l.replace(b'IFCVOIDINGFEATURE(',b'IFCOPENINGELEMENT(',1)
  l=re.sub(rb',\.[A-Z_]+\.\);',b',.OPENING.);',l);changed+=1
 rows.append(l)
(out/'minimal-as-opening-control.ifc').write_bytes(b''.join(rows))
print(json.dumps({'hostIds':hostids,'records':len(selected),'bytes':len(b),'controlChangedFeatures':changed},indent=2))
