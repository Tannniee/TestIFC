from pathlib import Path
import json,numpy as np,ifcopenshell,ifcopenshell.geom
root=Path(__file__).resolve().parent
original=Path(r'F:\Working\IFC Temp\Nhip chinh.ifc');full=ifcopenshell.open(original)
prefix=ifcopenshell.open(original)
for relation in list(prefix[286665].HasOpenings):
    if relation.RelatedOpeningElement.id()!=286682:prefix.remove(relation)
analytic=json.loads((root/'member-286665-arc-area.json').read_text())
rows=[]
for deflection in [5e-6,1e-6,.2e-6]:
    s=ifcopenshell.geom.settings();s.set(s.USE_WORLD_COORDS,True)
    s.set('mesher-linear-deflection',deflection)
    assert s.get('mesher-linear-deflection')==deflection
    for label,model in [('first',prefix),('full',full)]:
        shape=ifcopenshell.geom.create_shape(s,model[286665]);v=np.asarray(shape.geometry.verts).reshape(-1,3);t=np.asarray(shape.geometry.faces).reshape(-1,3);center=v.mean(0);a,b,c=(v[t[:,i]]-center for i in range(3));volume=float(abs(np.einsum('ij,ij->i',a,np.cross(b,c)).sum()/6))
        row={'label':label,'linearDeflectionMetres':deflection,'angularDeflectionRadians':s.get('mesher-angular-deflection'),'precisionSetting':s.get('precision'),'vertices':len(v),'triangles':len(t),'volumeM3':volume}
        if label=='first':row['minusAnalyticFirstM3']=volume-analytic['exactFirstCutMaterialVolumeM3']
        rows.append(row);print(json.dumps(row),flush=True)
        (root/f'member-286665-{label}-oracle-{deflection}.json').write_text(json.dumps({'vertices':v.tolist(),'indices':t.tolist(),'settings':row}))
(root/'member-286665-highres-oracle.json').write_text(json.dumps({'sourceFile':str(original),'ifcopenshellVersion':ifcopenshell.version,'analyticFirstVolumeM3':analytic['exactFirstCutMaterialVolumeM3'],'rows':rows},indent=2))
