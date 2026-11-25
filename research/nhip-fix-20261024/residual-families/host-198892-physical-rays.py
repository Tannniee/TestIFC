from pathlib import Path
import ast,json,numpy as np
root=Path(__file__).resolve().parent
helper=ast.parse((root/'member-last-three-rays.py').read_text())
exec(compile(ast.Module(body=[n for n in helper.body if isinstance(n,ast.FunctionDef)and n.name=='hits'],type_ignores=[]),'<rayhelper>','exec'))
source=json.loads((root/'host-198892-authored-operands.json').read_text());cutters={c['id']:c for c in source['cutters']}
rust=json.loads((root/'host-198892-rust-operands.json').read_text());stock=next(o for o in rust if o['id']==198892);origin=np.asarray(stock['origin'])
rows=[]
for scale in [256,16]:
    data=json.loads((root/'finite-physical'/f'nary-17-{scale}-physical.json').read_text());v=np.asarray(data['positions']).reshape(-1,3)+data.get('origin',[0,0,0])+origin;t=np.asarray(data['indices']).reshape(-1,3)
    for identifier,y,z in [(198908,-1.041,-1.86),(198920,1.041,-1.86),(198952,1.110,-2.400),(198956,-1.110,-2.400)]:
        cutter=cutters[identifier];source_hits=hits(np.asarray(cutter['vertices']),np.asarray(cutter['indices']),y,z)
        actual_hits=hits(v,t,y,z)
        expected_skin=.008-max(source_hits)
        actual_skin=actual_hits[-1]-actual_hits[-2]if len(actual_hits)>=2 else None
        row={'workScale':scale,'feature':identifier,'hostFrameRayYZM':[y,z],'sourceCutterIntersectionsXM':source_hits,'finalMaterialIntersectionsXM':actual_hits,'sourceBlindSkinMicrometres':expected_skin*1e6,'finalBlindSkinMicrometres':actual_skin*1e6 if actual_skin is not None else None};rows.append(row);print(json.dumps(row),flush=True)
        assert len(actual_hits)==2,'finite blind skin requires two actual material surfaces'
        assert actual_skin>35e-6,'resolvable blind skin was lost or collapsed'
        assert abs(actual_skin-expected_skin)<3e-6,'skin deviates more than3micrometres from authored cutter'
(root/'host-198892-physical-rays.json').write_text(json.dumps(rows,indent=2))
