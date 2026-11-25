from pathlib import Path
import json,numpy as np
p=Path(__file__).resolve().parent
exec((p/'compare-oracle.py').read_text(encoding='utf-8-sig').split('oracle=json.loads')[0])
o={r['id']:r for r in json.loads((p/'oracle-reference-and-body-hosts.json').read_text())['rows'] if 'vertices' in r};report=json.loads((p/'web-repro/live-web-detailed.json').read_text());rows=[]
for case in report['cases']:
 for m in case['meshes']:
  if m['id'] not in o:continue
  oracle=o[m['id']];offset=case['coordinateInfo']['wasmRtcOffset'];rtc=np.array([offset['x'],offset['y'],offset['z']]);v=np.array(m['positions']).reshape(-1,3)+m.get('origin',[0,0,0]);v=np.column_stack((v[:,0],-v[:,2],v[:,1]))+rtc;iv=np.asarray(m['indices']).reshape(-1,3);ov=np.array(oracle['vertices']);ot=np.array(oracle['indices']);center=ov.mean(axis=0);a=distances(sample(v,iv)-center,ov-center,ot);b=distances(sample(ov,ot)-center,v-center,iv);s=stats(v,iv);os=stats(ov,ot)
  r={'case':case['name'],'id':m['id'],'viewer':'live www.ifclite.com v5.2.0','geometry':s,'oracle':os,'sampledMaxSurfaceDistanceMm':float(max(a.max(),b.max())*1000),'directedSampleCounts':[len(a),len(b)],'maxBoundsDeltaMm':float(np.max(abs(np.array([v.min(axis=0),v.max(axis=0)])-np.array(oracle['bounds'])))*1000),'relativeVolumeErrorPercent':100*abs(s['volume']-os['volume'])/os['volume']};rows.append(r);print(json.dumps(r),flush=True)
(p/'live-web-oracle-comparison.json').write_text(json.dumps(rows,indent=2))
