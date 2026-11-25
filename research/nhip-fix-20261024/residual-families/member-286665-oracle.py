from pathlib import Path
import ast,json,numpy as np,ifcopenshell,ifcopenshell.geom
root=Path(__file__).resolve().parent
helper=ast.parse(Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024\compare-oracle.py').read_text())
exec(compile(ast.Module(body=[n for n in helper.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'))
f=ifcopenshell.open(root/'member-286665.ifc');host=f[286665]
s=ifcopenshell.geom.settings();s.set(s.USE_WORLD_COORDS,True)
shape=ifcopenshell.geom.create_shape(s,host)
ov=np.asarray(shape.geometry.verts).reshape(-1,3);ot=np.asarray(shape.geometry.faces).reshape(-1,3)
(root/'member-286665-oracle.json').write_text(json.dumps({'vertices':ov.tolist(),'indices':ot.tolist(),'stats':stats(ov,ot)}))
print('ORACLE',json.dumps(stats(ov,ot)),flush=True)
data=json.loads((root.parent/'closed-operands-worst.json').read_text());mesh=next(m for m in data['meshes'] if m['express_id']==286665)
v=world_native(data,mesh);t=np.asarray(mesh['indices']).reshape(-1,3);center=ov.mean(0)
asamp=sample(v,t);bsamp=sample(ov,ot)
a=distances(asamp-center,ov-center,ot);b=distances(bsamp-center,v-center,t)
witness={'native':stats(v,t),'oracle':stats(ov,ot),'nativeToOracleMaxMm':float(a.max()*1000),'oracleToNativeMaxMm':float(b.max()*1000),
'nativeWitnessWorld':asamp[a.argmax()].tolist(),'oracleWitnessWorld':bsamp[b.argmax()].tolist()}
(root/'member-286665-witness.json').write_text(json.dumps(witness,indent=2));print('WITNESS',json.dumps(witness),flush=True)
print('RESULT_KEYS',list(data),flush=True)
for key in data:
 if key!='meshes' and ('fail'in key.lower() or'diag'in key.lower()):print(key,str(data[key])[:1500],flush=True)
