from pathlib import Path
import ast,json,re,numpy as np,ifcopenshell,ifcopenshell.geom,ifcopenshell.util.placement as pl
root=Path(__file__).resolve().parent;source=Path(r'F:\Working\IFC Temp\Nhip chinh.ifc');f=ifcopenshell.open(source)
helper=ast.parse((root/'classify.py').read_text())
exec(compile(ast.Module(body=[n for n in helper.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'))
host=f[198892];parts=geometry(host);matrix=np.asarray(parts[0]['matrix']);rotation=matrix[:3,:3];translation=matrix[:3,3]*.001
def local(v):return (v-translation)@np.linalg.inv(rotation).T
roots=list(f.by_type('IfcProject'))+list(f.by_type('IfcSite'))+list(f.by_type('IfcBuilding'))+list(f.by_type('IfcBuildingStorey'))+[host]+list(host.HasOpenings)
selected={n.id()for r in roots for n in f.traverse(r)if n.id()};out=[]
for line in source.read_bytes().splitlines(keepends=True):
    mt=re.match(rb'#(\d+)\s*=',line)
    if not mt or int(mt[1])in selected:out.append(line)
target=root/'host-198892.ifc';target.write_bytes(b''.join(out))
s=ifcopenshell.geom.settings();s.set(s.USE_WORLD_COORDS,True)
operands=[]
for relation in host.HasOpenings:
    feature=relation.RelatedOpeningElement;info=geometry(feature);shape=ifcopenshell.geom.create_shape(s,feature)
    v=local(np.asarray(shape.geometry.verts).reshape(-1,3));t=np.asarray(shape.geometry.faces).reshape(-1,3)
    row={'id':feature.id(),'source':info,'vertices':v.tolist(),'indices':t.tolist(),'bounds':[v.min(0).tolist(),v.max(0).tolist()]};operands.append(row)
    print('CUT',feature.id(),[(x['type'],x.get('depthFile'),x.get('profile'))for x in info],row['bounds'],flush=True)
shape=ifcopenshell.geom.create_shape(s,host);oracle={'vertices':local(np.asarray(shape.geometry.verts).reshape(-1,3)).tolist(),'indices':np.asarray(shape.geometry.faces).reshape(-1,3).tolist()}
record={'hostId':198892,'host':parts,'sourceFrameMatrix':matrix.tolist(),'cutters':operands,'oracle':oracle}
(root/'host-198892-authored-operands.json').write_text(json.dumps(record))
order=[r.RelatedOpeningElement.id()for r in host.HasOpenings]
prefixes=[]
for count in range(len(order)+1):
    copy=ifcopenshell.open(target)
    for rel in list(copy[198892].HasOpenings):
        if rel.RelatedOpeningElement.id() not in order[:count]:copy.remove(rel)
    copy.write(root/f'host-198892-prefix-{count}.ifc')
    shape=ifcopenshell.geom.create_shape(s,copy[198892]);v=local(np.asarray(shape.geometry.verts).reshape(-1,3));t=np.asarray(shape.geometry.faces).reshape(-1,3);c=v.mean(0);a,b,d=(v[t[:,i]]-c for i in range(3));volume=float(abs(np.einsum('ij,ij->i',a,np.cross(b,d)).sum()/6))
    row={'count':count,'ids':order[:count],'volume':volume,'triangles':len(t)};prefixes.append(row);print('PREFIX',json.dumps(row),flush=True)
(root/'host-198892-prefix-oracle.json').write_text(json.dumps(prefixes,indent=2))
