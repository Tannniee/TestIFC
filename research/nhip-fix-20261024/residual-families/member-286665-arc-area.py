from pathlib import Path
import json,math,numpy as np,ifcopenshell,ifcopenshell.geom
root=Path(__file__).resolve().parent;f=ifcopenshell.open(root/'member-286665.ifc')
profile=f[286678];curve=profile.OuterCurve;points=np.asarray(curve.Points.CoordList)*.001
def cross(a,b):return a[0]*b[1]-a[1]*b[0]
exact_area=0.;native_points=[];arcs=[]
for segment in curve.Segments:
    ids=[int(i)-1 for i in segment.wrappedValue]
    if segment.is_a('IfcLineIndex'):
        for ia,ib in zip(ids,ids[1:]):exact_area+=.5*cross(points[ia],points[ib])
        native_points.extend(points[ids].tolist());continue
    a,b,c=points[ids];center=np.linalg.solve(2*np.asarray([b-a,c-a]),np.asarray([np.dot(b,b)-np.dot(a,a),np.dot(c,c)-np.dot(a,a)]));radius=float(np.linalg.norm(a-center));aa=math.atan2(a[1]-center[1],a[0]-center[0]);bb=math.atan2(b[1]-center[1],b[0]-center[0]);cc=math.atan2(c[1]-center[1],c[0]-center[0]);sweep=(cc-aa)%(2*math.pi)
    if (bb-aa)%(2*math.pi)>sweep:sweep-=2*math.pi
    exact_area+=.5*(center[0]*(c[1]-a[1])-center[1]*(c[0]-a[0])+radius**2*sweep)
    chord=np.linalg.norm(c-a);sag=np.linalg.norm(b-(a+c)/2);estimate=4*math.atan(2*sag/chord);segments=min(16,max(4,math.ceil(estimate/(math.pi/2)*8)))
    native_points.extend((center+radius*np.column_stack([np.cos(np.linspace(aa,aa+sweep,segments+1)),np.sin(np.linspace(aa,aa+sweep,segments+1))])).tolist())
    arcs.append({'radiusM':radius,'sweepRadians':sweep,'nativeSegments':segments,'nativeChordDeviationM':radius*(1-math.cos(abs(sweep)/(2*segments))),'nativeAreaDeficitM2':radius**2/2*(abs(sweep)-segments*math.sin(abs(sweep)/segments))})
exact_area=abs(exact_area)
def area(poly):return abs(sum(cross(a,b)for a,b in zip(poly,poly[1:]+poly[:1])))/2
native_area=area(native_points)
s=ifcopenshell.geom.settings();shape=ifcopenshell.geom.create_shape(s,profile);v=np.asarray(shape.verts).reshape(-1,3)[:,:2];edges=np.asarray(shape.edges).reshape(-1,2);adj={}
for a,b in edges:adj.setdefault(int(a),[]).append(int(b));adj.setdefault(int(b),[]).append(int(a))
loop=[next(iter(adj))];previous=None
while True:
    current=loop[-1];nxt=next(i for i in adj[current]if i!=previous)
    if nxt==loop[0]:break
    loop.append(nxt);previous=current
occ_area=area(v[loop].tolist())
classification=json.loads((root/'member-skew-classification.json').read_text())[0];axis=abs(classification['cutters'][0]['parts'][0]['hostLocalAxis'][0]);stock_volume=.016*2.872*3.95703058
result={'exactArcAreaM2':exact_area,'reproducedNativePolygonAreaM2':native_area,'occProfilePolygonAreaM2':occ_area,'occProfileVertices':len(loop),'arcs':arcs,'hostAxisCosine':axis,'analyticStockVolumeM3':stock_volume,'exactFirstCutMaterialVolumeM3':stock_volume-.016*exact_area/axis,'nativePolygonFirstCutMaterialVolumeM3':stock_volume-.016*native_area/axis,'occPolygonFirstCutMaterialVolumeM3':stock_volume-.016*occ_area/axis,'nativeMinusOccPolygonVolumeM3':.016*(occ_area-native_area)/axis,'nativeMinusExactVolumeM3':.016*(exact_area-native_area)/axis,'occMinusExactVolumeM3':.016*(exact_area-occ_area)/axis}
(root/'member-286665-arc-area.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
