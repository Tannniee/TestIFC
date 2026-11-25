import ifcopenshell, ifcopenshell.geom, ifcopenshell.util.shape
import json,time
p=r'F:\Working\IFC Temp\Nhip chinh.ifc';t=time.time();f=ifcopenshell.open(p)
print('OPEN',round(time.time()-t,2),f.schema,flush=True)
from collections import Counter
voids=f.by_type('IfcRelVoidsElement'); c=Counter(r.RelatingBuildingElement.is_a() for r in voids)
print('VOIDHOST TYPES',c,flush=True)
print('VOIDS',Counter(r.RelatedOpeningElement.is_a() for r in voids),flush=True)
# Summarise unusually large tessellated negative features and the first host/cutter chain.
for r in voids[:4]:
 print('REL',r,flush=True)
 print('HOST',r.RelatingBuildingElement,flush=True)
 print('CUTTER',r.RelatedOpeningElement,flush=True)
for typ in ['IfcVoidingFeature','IfcBeam','IfcPlate']:
 items=f.by_type(typ); print(typ,'COUNT',len(items),'FIRST',str(items[0]) if items else '',flush=True)
