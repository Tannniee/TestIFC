from pathlib import Path
import ast,json,re,numpy as np,ifcopenshell,ifcopenshell.geom,ifcopenshell.util.placement as pl

root=Path(__file__).resolve().parent
source=Path(r'F:\Working\IFC Temp\Nhip chinh.ifc')
model=ifcopenshell.open(source)
scope={}
module=ast.parse((root/'classify.py').read_text())
exec(compile(ast.Module(body=[n for n in module.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'),globals())
rows=[]
for identifier in [286665,286744,286882,286961,287038,292599]:
    host=model[identifier];parts=geometry(host)
    row={'id':identifier,'host':parts,'cutters':[],'profiles':[]}
    for part in parts:
        if 'profileId' not in part:continue
        profile=model[part['profileId']]
        for name in ['OuterCurve','InnerCurves']:
            curve=getattr(profile,name,None)
            if curve:
                if isinstance(curve,tuple):row['profiles'].append([str(x)for x in curve])
                else:
                    row['profiles'].append({'id':curve.id(),'record':str(curve),'dependencies':[str(x)for x in model.traverse(curve)]})
                    print('PROFILE',identifier,json.dumps(row['profiles'][-1]),flush=True)
    host_matrix=np.asarray(parts[0]['matrix']);inverse=np.linalg.inv(host_matrix)
    for relation in host.HasOpenings:
        feature=relation.RelatedOpeningElement
        cp=geometry(feature)
        for part in cp:
            if 'matrix' in part:
                mm=inverse@np.asarray(part['matrix']);part['hostLocalMatrix']=mm.tolist()
                part['hostLocalAxis']=(inverse[:3,:3]@np.asarray(part['axis'])).tolist()
        row['cutters'].append({'id':feature.id(),'parts':cp})
    rows.append(row)
    if identifier==286665:
        roots=list(model.by_type('IfcProject'))+list(model.by_type('IfcSite'))+list(model.by_type('IfcBuilding'))+list(model.by_type('IfcBuildingStorey'))+[host]+list(host.HasOpenings)
        selected={n.id() for r in roots for n in model.traverse(r) if n.id()}
        content=[]
        for line in source.read_bytes().splitlines(keepends=True):
            mt=re.match(rb'#(\d+)\s*=',line)
            if not mt or int(mt[1])in selected:content.append(line)
        (root/f'member-{identifier}.ifc').write_bytes(b''.join(content))
    print('FAMILY',identifier,'cuts',len(row['cutters']),'depth',parts[0].get('depthFile'),flush=True)
(root/'member-skew-classification.json').write_text(json.dumps(rows,indent=2))
