"""Independent 2D finite material subtraction; diagnostic only, never repairs output."""
from pathlib import Path
import json, sys
import numpy as np
import ifcopenshell, ifcopenshell.geom, ifcopenshell.util.placement, ifcopenshell.util.unit
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union

root = Path(__file__).resolve().parent
cohort = root / sys.argv[1]
run = json.loads((cohort/'report.json').read_text())
capture = json.loads((cohort/'selected-meshes.json').read_text())
model = ifcopenshell.open(run['model'])
scale = ifcopenshell.util.unit.calculate_unit_scale(model)
settings = ifcopenshell.geom.settings()
settings.set(settings.USE_WORLD_COORDS, True)
settings.set(settings.DISABLE_OPENING_SUBTRACTIONS, True)
settings.set('mesher-linear-deflection', 1e-6)
rtc = capture['coordinateInfo'].get('wasmRtcOffset', {'x':0,'y':0,'z':0})

def section(mesh, z):
    v,t = mesh
    triangles = v[t]
    lines = []
    for tri in triangles:
        hits = []
        for a,b in zip(tri,np.roll(tri,-1,axis=0)):
            if (a[2]-z)*(b[2]-z)<0:
                p=a+(b-a)*((z-a[2])/(b[2]-a[2]))
                hits.append(tuple(np.round(p[:2],9)))
        if len(set(hits))==2: lines.append(LineString(hits))
    cells=list(polygonize(unary_union(lines)))
    if not cells: return unary_union([])
    a,b,c=triangles[:,0],triangles[:,1],triangles[:,2]
    ab=b[:,1:]-a[:,1:];ac=c[:,1:]-a[:,1:]
    det=ab[:,0]*ac[:,1]-ab[:,1]*ac[:,0]
    safe=np.where(abs(det)>1e-20,det,1)
    kept=[]
    for cell in cells:
        p=cell.representative_point();ap=np.array([p.y,z])-a[:,1:]
        u=(ap[:,0]*ac[:,1]-ap[:,1]*ac[:,0])/safe
        w=(ab[:,0]*ap[:,1]-ab[:,1]*ap[:,0])/safe
        valid=(abs(det)>1e-20)&(u>0)&(w>0)&(u+w<1)
        xs=a[:,0]+u*(b[:,0]-a[:,0])+w*(c[:,0]-a[:,0])
        if np.count_nonzero(valid&(xs>p.x))%2: kept.append(cell)
    return unary_union(kept)

rows=[]
for entity_id in [178955,198892]:
    host=model.by_id(entity_id)
    frame=ifcopenshell.util.placement.get_local_placement(host.ObjectPlacement)
    frame[:3,3]*=scale
    inverse=np.linalg.inv(frame)
    def local(vertices):
        return (vertices-frame[:3,3])@inverse[:3,:3].T
    def operand(entity):
        shape=ifcopenshell.geom.create_shape(settings,entity)
        return local(np.asarray(shape.geometry.verts).reshape(-1,3)),np.asarray(shape.geometry.faces).reshape(-1,3)
    stock=operand(host)
    cutters=[]
    for relation in host.HasOpenings:
        cutter=relation.RelatedOpeningElement
        if any(rep.RepresentationIdentifier=='Body' for rep in cutter.Representation.Representations):
            cutters.append(operand(cutter))
    mesh=next(m for m in capture['meshes'] if m['expressId']==entity_id)
    p=np.asarray(mesh['positions']).reshape(-1,3)+mesh.get('origin',[0,0,0])
    world=np.column_stack((p[:,0]+rtc['x'],-p[:,2]+rtc['y'],p[:,1]+rtc['z']))
    actual=(local(world),np.asarray(mesh['indices']).reshape(-1,3))
    lo,hi=stock[0][:,2].min(),stock[0][:,2].max()
    sections=[]
    for fraction in np.linspace(.0137,.9863,33):
        z=lo+(hi-lo)*fraction
        expected=section(stock,z)
        for cutter in cutters: expected=expected.difference(section(cutter,z))
        got=section(actual,z)
        raw=got.symmetric_difference(expected).area
        # Explicit diagnostic material margin equals IFC Precision / 2.
        ep=expected.buffer(-.0001,join_style=2).buffer(.0001,join_style=2)
        gp=got.buffer(-.0001,join_style=2).buffer(.0001,join_style=2)
        distance=gp.hausdorff_distance(ep)
        sections.append({'z':float(z),'rawSymmetricDifferenceAreaM2':raw,
                         'rawActualAreaM2':got.area,'rawReferenceAreaM2':expected.area,
                         'precisionMarginHausdorffMm':distance*1000})
    row={'id':entity_id,'bodyCutters':len(cutters),'sections':sections,
         'maxRawSymmetricDifferenceAreaM2':max(s['rawSymmetricDifferenceAreaM2'] for s in sections),
         'maxPrecisionMarginHausdorffMm':max(s['precisionMarginHausdorffMm'] for s in sections)}
    rows.append(row)
    print(json.dumps(row),flush=True)
(cohort/'independent-section-qualified.json').write_text(json.dumps({
    'method':'33 interior sections, OCC operands with 1 micrometre chord deflection, finite Shapely differences; 0.1 mm material opening explicitly reported separately from raw surface',
    'rows':rows},indent=2))
