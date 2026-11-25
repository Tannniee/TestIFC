from pathlib import Path
from collections import Counter
import json,numpy as np,sys
p=Path(__file__).parent/'no-prism-source'/f'{sys.argv[1]}-bad-raw.json';d=json.loads(p.read_text());v=np.asarray(d['positions'],dtype=np.float32).reshape(-1,3);t=np.asarray(d['indices']).reshape(-1,3)
keys=[tuple(float(x) for x in q)for q in v];c=Counter()
for tri in t:
 for a,b in zip(tri,np.roll(tri,-1)):c[keys[a],keys[b]]+=1
edges=[(a,b,n-c[b,a])for(a,b),n in c.items()if n>c[b,a]];ps=sorted(set(p for a,b,_ in edges for p in[a,b]));labels={p:i for i,p in enumerate(ps)}
print('points',list(enumerate(ps)));print('edges',[(labels[a],labels[b],n)for a,b,n in edges]);print('multiplicities',Counter(c.values()))
