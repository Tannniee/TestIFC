from pathlib import Path
import ifcopenshell,json
from collections import Counter
f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc');out=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024');features=f.by_type('IfcVoidingFeature');reps=Counter();reference_only=[];hosts={};hostreps=Counter()
for e in features:
 rr=e.Representation.Representations if e.Representation else []
 for r in rr:reps[(r.RepresentationIdentifier,r.RepresentationType)]+=1
 if rr and all(r.RepresentationIdentifier in ('Reference','Box') for r in rr):reference_only.append(e.id())
for rel in f.by_type('IfcRelVoidsElement'):hosts[rel.RelatingBuildingElement.id()]=rel.RelatingBuildingElement
for h in hosts.values():
 for r in h.Representation.Representations:hostreps[(r.RepresentationIdentifier,r.RepresentationType)]+=1
r={'features':len(features),'referenceOnlyFeatures':len(reference_only),'featureRepresentations':[{'identifier':a,'type':b,'count':c} for (a,b),c in reps.items()],'hostCount':len(hosts),'hostRepresentations':[{'identifier':a,'type':b,'count':c} for (a,b),c in hostreps.items()]};(out/'representation-census.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
