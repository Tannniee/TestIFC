from pathlib import Path
import ifcopenshell,ifcopenshell.geom,numpy as np,json,time
out=Path(__file__).resolve().parent;f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc');rows=[]
for i in [434,820,64951,322443,266636,344051,2361,2444]:
 e=f[i];rep_ids={r.RepresentationIdentifier for rel in e.HasOpenings for r in rel.RelatedOpeningElement.Representation.Representations};reference_only=rep_ids=={'Reference'}
 s=ifcopenshell.geom.settings();s.set('use-world-coords',True);s.set('disable-opening-subtractions',reference_only);t=time.time()
 try:
  sh=ifcopenshell.geom.create_shape(s,e,geometry_library='opencascade');v=np.asarray(sh.geometry.verts).reshape(-1,3);tri=np.asarray(sh.geometry.faces).reshape(-1,3)
  r={'id':i,'GlobalId':e.GlobalId,'type':e.is_a(),'referenceOnly':reference_only,'cutIdentifiers':sorted(rep_ids),'seconds':time.time()-t,'vertices':v.tolist(),'indices':tri.tolist(),'bounds':[v.min(axis=0).tolist(),v.max(axis=0).tolist()]}
 except Exception as ex:r={'id':i,'referenceOnly':reference_only,'seconds':time.time()-t,'error':str(ex)}
 rows.append(r);print(json.dumps({k:v for k,v in r.items() if k not in ['vertices','indices']}),flush=True)
(out/'oracle-reference-and-body-hosts.json').write_text(json.dumps({'engine':ifcopenshell.version,'kernel':'opencascade','rows':rows},indent=2))
