from pathlib import Path
import ast,json,numpy as np,ifcopenshell,ifcopenshell.geom

root=Path(__file__).resolve().parent
helper=ast.parse(Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024\compare-oracle.py').read_text())
exec(compile(ast.Module(body=[n for n in helper.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'))
order=[490765,490771,490775,490779,490783,490787,490791]
rows=[]
for prefix in range(8):
    f=ifcopenshell.open(root/'plate-490757.ifc')
    host=f[490757]
    for relation in list(host.HasOpenings):
        if relation.RelatedOpeningElement.id() not in order[:prefix]:f.remove(relation)
    settings=ifcopenshell.geom.settings();settings.set(settings.USE_WORLD_COORDS,True)
    shape=ifcopenshell.geom.create_shape(settings,host)
    v=np.asarray(shape.geometry.verts).reshape(-1,3);t=np.asarray(shape.geometry.faces).reshape(-1,3)
    result={'prefix':prefix,'openingIds':order[:prefix],**stats(v,t)}
    rows.append(result)
    (root/f'plate-prefix-{prefix}-oracle.json').write_text(json.dumps({'vertices':v.tolist(),'indices':t.tolist()}))
    f.write(root/f'plate-prefix-{prefix}.ifc')
    print(json.dumps(result),flush=True)
(root/'plate-prefix-oracle.json').write_text(json.dumps(rows,indent=2))

data=json.loads((root.parent/'centered-frame-five.json').read_text())
mesh=next(m for m in data['meshes'] if m['express_id']==490757)
v=world_native(data,mesh);t=np.asarray(mesh['indices']).reshape(-1,3)
ov=np.asarray(json.loads((root/'plate-prefix-7-oracle.json').read_text())['vertices'])
ot=np.asarray(json.loads((root/'plate-prefix-7-oracle.json').read_text())['indices']);center=ov.mean(0)
a_samples=sample(v,t);b_samples=sample(ov,ot)
a=distances(a_samples-center,ov-center,ot);b=distances(b_samples-center,v-center,t)
witness={'nativeToOracleMaxMm':float(a.max()*1000),'oracleToNativeMaxMm':float(b.max()*1000),
         'nativeWitnessWorld':a_samples[a.argmax()].tolist(),'oracleWitnessWorld':b_samples[b.argmax()].tolist(),
         'nativeVolume':stats(v,t)['volume'],'oracleVolume':stats(ov,ot)['volume']}
(root/'plate-centered-surface-witness.json').write_text(json.dumps(witness,indent=2))
print(json.dumps(witness),flush=True)
