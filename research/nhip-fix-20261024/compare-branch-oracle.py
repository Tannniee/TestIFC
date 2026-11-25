from pathlib import Path
import ast,json,numpy as np,ifcopenshell,ifcopenshell.geom
research=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024')
out=Path(r'F:\Steel\VBA\IFC-Lite-Core104\research\nhip-fix-20261024')
helpers=ast.parse((research/'compare-oracle.py').read_text())
exec(compile(ast.Module(body=[n for n in helpers.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<geometry-helpers>','exec'))
data=json.loads((out/'branch-full-selected.json').read_text())
rows=json.loads((research/'oracle-reference-and-body-hosts.json').read_text())['rows']
oracle={r['id']:r for r in rows if 'vertices' in r}
missing={m['express_id'] for m in data['meshes']}-oracle.keys()
if missing:
 source=ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc')
 for i in missing:
  e=source.by_id(i);rep_ids={r.RepresentationIdentifier for rel in e.HasOpenings for r in rel.RelatedOpeningElement.Representation.Representations};reference_only=rep_ids=={'Reference'}
  s=ifcopenshell.geom.settings();s.set('use-world-coords',True);s.set('disable-opening-subtractions',reference_only)
  shape=ifcopenshell.geom.create_shape(s,e,geometry_library='opencascade');v=np.asarray(shape.geometry.verts).reshape(-1,3);tri=np.asarray(shape.geometry.faces).reshape(-1,3)
  oracle[i]={'id':i,'GlobalId':e.GlobalId,'type':e.is_a(),'referenceOnly':reference_only,'vertices':v.tolist(),'indices':tri.tolist(),'bounds':[v.min(axis=0).tolist(),v.max(axis=0).tolist()]}
results=[]
for i in sorted({m['express_id'] for m in data['meshes']}):
 meshes=[m for m in data['meshes'] if m['express_id']==i];vv=[];tt=[];offset=0
 for m in meshes:
  v=world_native(data,m);t=np.asarray(m['indices']).reshape(-1,3);vv.append(v);tt.append(t+offset);offset+=len(v)
 v=np.concatenate(vv);t=np.concatenate(tt);o=oracle[i];ov=np.asarray(o['vertices']);ot=np.asarray(o['indices']);center=ov.mean(axis=0)
 a=distances(sample(v,t)-center,ov-center,ot);b=distances(sample(ov,ot)-center,v-center,t)
 actual=stats(v,t);expected=stats(ov,ot)
 row={'id':i,'type':o['type'],'referenceOnly':o['referenceOnly'],'native':actual,'oracle':expected,'maxBoundsDeltaMm':float(np.max(abs(np.array([v.min(axis=0),v.max(axis=0)])-np.array(o['bounds'])))*1000),'sampledMaxSurfaceDistanceMm':float(max(a.max(),b.max())*1000),'sampledP99SurfaceDistanceMm':float(max(np.percentile(a,99),np.percentile(b,99))*1000),'directedSampleCounts':[len(a),len(b)],'relativeVolumeErrorPercent':100*abs(actual['volume']-expected['volume'])/expected['volume'] if expected['volume'] else None}
 results.append(row);print(json.dumps(row),flush=True)
report={'oracle':'IfcOpenShell 0.8.5 / OpenCASCADE; Reference-only cutters disabled per IFC representation semantics','method':'symmetric sampled point-to-triangle distance; vertices, face centroids, and three 0.6/0.2/0.2 barycentric samples per triangle; not exact Hausdorff','sourceFile':r'F:\Working\IFC Temp\Nhip chinh.ifc','nativeFile':str(out/'branch-full-selected.json'),'nativeStats':data['stats'],'rows':results}
(out/'branch-oracle-comparison.json').write_text(json.dumps(report,indent=2))
