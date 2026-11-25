from pathlib import Path
import runpy,json,ast,numpy as np,sys
from shapely import points,distance
from shapely.ops import triangulate,polygonize,unary_union
from shapely.geometry import Point,LineString
p=Path(__file__).parent;ref=runpy.run_path(str(p/'independent-slices.py'))
helpers=ast.parse(Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024\compare-oracle.py').read_text())
exec(compile(ast.Module(body=[n for n in helpers.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'))
d=json.loads((p/sys.argv[1]).read_text());m=next(x for x in d['meshes']if x['express_id']==490757)
frame=ref['frame'];v=(world_native(d,m)-frame[:3,3]/1000)@ref['inv'][:3,:3].T;t=np.asarray(m['indices']).reshape(-1,3)
zs=np.linspace(ref['zlo']+2/65536,ref['zhi']-2/65536,101);polys=[];actual_polys=[]
def actual_section(z):
 tris=v[t];segments=[]
 for tri in tris:
  hits=[]
  for a,b in zip(tri,np.roll(tri,-1,axis=0)):
   if (a[2]-z)*(b[2]-z)<0:
    q=a+(b-a)*((z-a[2])/(b[2]-a[2]));hits.append(tuple(np.round(q[:2],9)))
  if len(set(hits))==2:segments.append(LineString(hits))
 cells=list(polygonize(unary_union(segments)));kept=[]
 a,b,c=tris[:,0],tris[:,1],tris[:,2];ab=b[:,1:]-a[:,1:];ac=c[:,1:]-a[:,1:]
 det=ab[:,0]*ac[:,1]-ab[:,1]*ac[:,0];safe=np.where(abs(det)>1e-20,det,1)
 for cell in cells:
  q=cell.representative_point();ap=np.array([q.y,z])-a[:,1:]
  u=(ap[:,0]*ac[:,1]-ap[:,1]*ac[:,0])/safe;w=(ab[:,0]*ap[:,1]-ab[:,1]*ap[:,0])/safe
  valid=(abs(det)>1e-20)&(u>0)&(w>0)&(u+w<1);xs=a[:,0]+u*(b[:,0]-a[:,0])+w*(c[:,0]-a[:,0])
  if np.count_nonzero(valid&(xs>q.x))%2:kept.append(cell)
 return unary_union(kept)
for z in zs:
 stock=ref['section'](ref['meshes'][0],z)
 for cutter in ref['meshes'][1:]:stock=stock.difference(ref['section'](cutter,z))
 stock=stock.buffer(-0.0001,join_style=2).buffer(0.0001,join_style=2)
 polys.append(stock)
 actual_polys.append(actual_section(z).buffer(-0.0001,join_style=2).buffer(0.0001,join_style=2))
samples=sample(v,t);plane=np.clip(np.rint((samples[:,2]-zs[0])/(zs[-1]-zs[0])*100).astype(int),0,100);actual_errors=[];worst=(0,None);ignored=0
for i,polygon in enumerate(polys):
 q=samples[plane==i]
 if not len(q):continue
 retained=distance(points(q[:,:2]),actual_polys[i])<=0.00011
 ignored+=int(np.count_nonzero(~retained));q=q[retained]
 if not len(q):continue
 xy=points(q[:,:2]);outside=distance(xy,polygon);boundary=distance(xy,polygon.boundary)
 cap=np.minimum(abs(q[:,2]-ref['zlo']),abs(q[:,2]-ref['zhi']))
 dz=np.maximum(np.maximum(ref['zlo']-q[:,2],q[:,2]-ref['zhi']),0)
 errors=np.where(outside>0,np.hypot(outside,dz),np.minimum(boundary,cap));actual_errors.extend(errors)
 if errors.max()>worst[0]:worst=(float(errors.max()),q[errors.argmax()].tolist())
expected=[]
for i in [0,50,100]:
 poly=polys[i]
 for component in getattr(poly,'geoms',[poly]):
  for ring in [component.exterior,*component.interiors]:
   expected.extend([[a,b,zs[i]]for a,b in ring.coords])
 if i in [0,100]:
  for tri in triangulate(poly):
   q=tri.centroid
   if poly.covers(q):expected.append([q.x,q.y,zs[i]])
expected=np.asarray(expected);reverse=distances(expected,v,t)
actual_volume=stats(v,t)['volume'];expected_volume=float(ref['vol'][-1])
row={'id':490757,'reference':'101 independent planar material differences; remove sub-Precision material films using opening radius Precision/2; no 3D CSG oracle',
 'nativeVolume':actual_volume,'referenceVolume':expected_volume,'relativeVolumeErrorPercent':100*abs(actual_volume-expected_volume)/expected_volume,
 'sampledMaxSurfaceDistanceMm':float(max(max(actual_errors),max(reverse))*1000),'directedSampleCounts':[len(samples),len(expected)],
 'OCCBooleanVolume':0.024292965421886997,'OCCMissedCut':490787,'samplesOnSubPrecisionFilms':ignored}
print(json.dumps(row),flush=True)
print('WORST_ACTUAL',worst,'WORST_REFERENCE',float(reverse.max()),expected[reverse.argmax()].tolist(),flush=True)
(p/Path(sys.argv[1]).with_suffix('.sections.json')).write_text(json.dumps(row,indent=2))
assert row['sampledMaxSurfaceDistanceMm']<1.0,row
assert row['relativeVolumeErrorPercent']<0.1,row
