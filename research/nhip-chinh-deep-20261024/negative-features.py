import ifcopenshell,ifcopenshell.geom,json,time
from pathlib import Path
f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc');s=ifcopenshell.geom.settings();s.set('use-world-coords',True)
rows=[]
for e in f.by_type('IfcVoidingFeature')[:30]:
 t=time.time()
 try:
  sh=ifcopenshell.geom.create_shape(s,e);v=sh.geometry.verts
  lo=[min(v[i::3]) for i in range(3)];hi=[max(v[i::3]) for i in range(3)]
  r={'id':e.id(),'type':e.is_a(),'Name':e.Name,'ObjectType':e.ObjectType,'dims':[hi[i]-lo[i] for i in range(3)],'triangles':len(sh.geometry.faces)//3,'materials':[{'name':m.name,'rgb':str(m.diffuse)} for m in sh.geometry.materials],'seconds':time.time()-t}
 except Exception as ex:r={'id':e.id(),'error':str(ex)}
 rows.append(r);print(json.dumps(r),flush=True)
p=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024');(p/'first-30-negative-features.json').write_text(json.dumps(rows,indent=2))
