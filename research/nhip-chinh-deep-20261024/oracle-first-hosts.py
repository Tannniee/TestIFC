from pathlib import Path
import ifcopenshell,ifcopenshell.geom,ifcopenshell.util.shape,json,time,numpy as np
out=Path(__file__).resolve().parent;f=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc');rows=[]
for i in [434,463,475,820,855,865,2391]:
 for cut in [True,False] if i in [434,820] else [False]:
  e=f[i];s=ifcopenshell.geom.settings();s.set('use-world-coords',True);s.set('disable-opening-subtractions',not cut);t=time.time()
  try:
   sh=ifcopenshell.geom.create_shape(s,e,geometry_library='opencascade');v=np.asarray(sh.geometry.verts).reshape(-1,3);tri=np.asarray(sh.geometry.faces).reshape(-1,3)
   r={'id':i,'GlobalId':e.GlobalId,'type':e.is_a(),'cut':cut,'seconds':time.time()-t,'vertices':v.tolist(),'indices':tri.tolist(),'bounds':[v.min(axis=0).tolist(),v.max(axis=0).tolist()],'volume':float(ifcopenshell.util.shape.get_volume(sh.geometry)),'materials':[{ 'name':m.name,'diffuse':str(m.diffuse)} for m in sh.geometry.materials]}
  except Exception as ex:r={'id':i,'cut':cut,'seconds':time.time()-t,'error':str(ex)}
  rows.append(r);print(json.dumps({k:v for k,v in r.items() if k not in ['vertices','indices','materials']}),flush=True)
(out/'oracle-first-hosts.json').write_text(json.dumps({'engine':ifcopenshell.version,'kernel':'opencascade','rows':rows},indent=2))

