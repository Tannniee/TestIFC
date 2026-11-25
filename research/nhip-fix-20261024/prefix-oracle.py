from pathlib import Path
import ifcopenshell,ifcopenshell.geom,numpy as np,json,sys
p=Path(__file__).parent; i=int(sys.argv[1]);family='plate' if i==490757 else 'member'
source=(p/'residual-families'/f'{family}-{i}.ifc').read_text(encoding='utf8')
order=[490765,490771,490775,490779,490783,490787,490791] if i==490757 else sorted(r.RelatedOpeningElement.id() for r in ifcopenshell.file.from_string(source)[i].HasOpenings)
out=[]
for count in range(len(order)+1):
 f=ifcopenshell.file.from_string(source)
 for rel in list(f[i].HasOpenings):
  if rel.RelatedOpeningElement.id() not in order[:count]:f.remove(rel)
 if count in [0,1]:f.write(str(p/'residual-families'/f'{family}-{i}-prefix-{count}.ifc'))
 s=ifcopenshell.geom.settings();s.set(s.USE_WORLD_COORDS,True)
 sh=ifcopenshell.geom.create_shape(s,f[i]);v=np.asarray(sh.geometry.verts).reshape(-1,3);t=np.asarray(sh.geometry.faces).reshape(-1,3);v-=v.mean(0)
 a,b,c=(v[t[:,j]]for j in range(3));vol=abs(np.einsum('ij,ij->i',a,np.cross(b,c)).sum()/6)
 row={'count':count,'lastId':order[count-1] if count else None,'volume':vol,'triangles':len(t)};out.append(row);print(json.dumps(row),flush=True)
(p/f'prefix-oracle-{i}.json').write_text(json.dumps(out,indent=2))
