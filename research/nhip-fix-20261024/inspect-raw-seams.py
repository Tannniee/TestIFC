from pathlib import Path
from collections import Counter,defaultdict
import json,numpy as np,sys
for f in sorted((Path(__file__).parent/(sys.argv[1] if len(sys.argv)>1 else 'raw-source')).glob('*bad*.json' if len(sys.argv)>1 else '*.json')):
 d=json.loads(f.read_text());p=np.asarray(d['positions'],dtype=np.float32).reshape(-1,3);t=np.asarray(d['indices']).reshape(-1,3)
 keys=[tuple(float(v) for v in x) for x in p]; c=Counter()
 for tri in t:
  for a,b in zip(tri,np.roll(tri,-1)):c[keys[a],keys[b]]+=1
 edges=[]
 for (a,b),n in c.items():
  delta=n-c[b,a]
  if delta>0:edges.extend([(a,b)]*delta)
 if not edges:continue
 neighbors=defaultdict(set)
 for a,b in edges:neighbors[a].add(b);neighbors[b].add(a)
 visited=set();parts=[]
 for a in sorted(neighbors):
  if a in visited:continue
  stack=[a];component=[]
  while stack:
   x=stack.pop()
   if x in visited:continue
   visited.add(x);component.append(x);stack.extend(neighbors[x]-visited)
  arr=np.asarray(component); center=arr.mean(0); _,sv,_=np.linalg.svd(arr-center,full_matrices=False)
  parts.append({'vertices':len(component),'span':np.ptp(arr,axis=0).tolist(),'singular':sv.tolist(),'points':component if len(component)<12 else []})
 print(f.name,'triangles',len(t),'unpaired',len(edges),'parts',json.dumps(parts))
