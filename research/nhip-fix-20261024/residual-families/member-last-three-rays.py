from pathlib import Path
import ast,json,sys,numpy as np,ifcopenshell,ifcopenshell.geom
root=Path(__file__).resolve().parent
helper=ast.parse(Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024\compare-oracle.py').read_text())
exec(compile(ast.Module(body=[n for n in helper.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<helpers>','exec'))
f=ifcopenshell.open(root/'member-286665.ifc')
classification=json.loads((root/'member-skew-classification.json').read_text())[0]
matrix=np.asarray(classification['host'][0]['matrix']);rotation=matrix[:3,:3];translation=matrix[:3,3]*.001
def host_local(v):return (v-translation)@np.linalg.inv(rotation).T

def hits(v,t,y,z):
    tri=v[t];a=tri[:,0];ab=tri[:,1]-a;ac=tri[:,2]-a
    determinant=ab[:,1]*ac[:,2]-ab[:,2]*ac[:,1]
    valid=abs(determinant)>1e-18;den=np.where(valid,determinant,1.)
    dy=y-a[:,1];dz=z-a[:,2]
    u=(dy*ac[:,2]-dz*ac[:,1])/den;w=(ab[:,1]*dz-ab[:,2]*dy)/den
    valid &= (u>=-1e-10)&(w>=-1e-10)&(u+w<=1+1e-10)
    xx=(a[:,0]+u*ab[:,0]+w*ac[:,0])[valid];xx.sort()
    answer=[]
    for x in xx:
        if not answer or abs(x-answer[-1])>1e-9:answer.append(float(x))
    return answer

settings=ifcopenshell.geom.settings();settings.set(settings.USE_WORLD_COORDS,True)
cutters={}
for feature in classification['cutters']:
    shape=ifcopenshell.geom.create_shape(settings,f[feature['id']]);v=host_local(np.asarray(shape.geometry.verts).reshape(-1,3));t=np.asarray(shape.geometry.faces).reshape(-1,3)
    cutters[feature['id']]=(v,t)
oracle=json.loads((root/'member-286665-oracle.json').read_text());ov=host_local(np.asarray(oracle['vertices']));ot=np.asarray(oracle['indices'])
input_path=root.parent/(sys.argv[1]if len(sys.argv)>1 else 'finite-closed-worst.json')
data=json.loads(input_path.read_text());mesh=next(m for m in data['meshes'] if m['express_id']==286665);v=host_local(world_native(data,mesh));t=np.asarray(mesh['indices']).reshape(-1,3)
rows=[]
for feature,y,z in [(286722,-1.420,-3.940),(286728,1.420,-.020),(286734,-1.420,-.020)]:
    allhits={str(i):hits(cv,ct,y,z) for i,(cv,ct)in cutters.items()}
    row={'id':feature,'hostFrameRayOriginM':[-.020,y,z],'direction':[1,0,0],
         'nativeIntersectionsXM':hits(v,t,y,z),'oracleIntersectionsXM':hits(ov,ot,y,z),
         'authoredCutterIntersectionsXM':{i:h for i,h in allhits.items()if h},
         'worldWitnessAtStockCenterM':(rotation@np.array([0.,y,z])+translation).tolist()}
    rows.append(row);print(json.dumps(row),flush=True)
output_name='member-286665-last-three-rays.json'if len(sys.argv)==1 else f'member-286665-{input_path.stem}-rays.json'
(root/output_name).write_text(json.dumps(rows,indent=2))
print('VOLUME',stats(v,t)['volume'],flush=True)
