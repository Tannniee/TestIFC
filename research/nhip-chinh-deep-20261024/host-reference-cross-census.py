from pathlib import Path
import ifcopenshell,json
from collections import Counter
f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc');cross=Counter();hosts={};pairHosts={}
for rel in f.by_type('IfcRelVoidsElement'):
 h,o=rel.RelatingBuildingElement,rel.RelatedOpeningElement
 hk=tuple(sorted((r.RepresentationIdentifier,r.RepresentationType) for r in h.Representation.Representations if r.RepresentationIdentifier not in ('Axis','CoG','Box')))
 ok=tuple(sorted((r.RepresentationIdentifier,r.RepresentationType) for r in o.Representation.Representations))
 cross[(str(hk),str(ok))]+=1;pairHosts.setdefault((str(hk),str(ok)),set()).add(h.id());hosts[h.id()]=h
rows=[{'hostRepresentations':h,'featureRepresentations':o,'relationships':c,'hosts':len(pairHosts[(h,o)])} for (h,o),c in cross.items()]
p=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024');(p/'host-reference-cross-census.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows,indent=2))
