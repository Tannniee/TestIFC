import pathlib,subprocess,json,time,statistics,hashlib
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'research/nhip-load-20261027'
model=pathlib.Path('F:/Working/IFC Temp/Nhip chinh.ifc')
report={'source':str(root),'model':str(model),'scope':'Interleaved fresh-process canonical native worker-pool stream including production packet encoding; excludes UI, IPC waits and semantics. OS file cache uncontrolled.', 'fixtures':{},'full':[]}
def save(): (out/'native-ab.json').write_text(json.dumps(report,indent=2))
def run(cmd,label):
    with (out/(label+'.stdout.log')).open('wb') as stdout,(out/(label+'.stderr.log')).open('wb') as stderr:
        subprocess.run(cmd,cwd=root,stdout=stdout,stderr=stderr,check=True)
fixtures={'house':'tests/models/ara3d/AC20-FZK-Haus.ifc','issue129':'tests/models/ara3d/ISSUE_129_N1540_17_EXE_MOD_448200_02_09_11SMC_IGC_V17.ifc'}
for name,fixture in fixtures.items():
    runs=[]; report['fixtures'][name]=runs
    for pair in range(5):
        for variant in ['base','branch']:
            label=f'{name}-{pair+1}-{variant}'
            run([str(out/f'perf-probe-{variant}.exe'),fixture,'--iters','1','--json','--fingerprint'],label)
            value=json.loads((out/(label+'.stdout.log')).read_text())
            runs.append({'pair':pair+1,'variant':variant,'result':value});save()
    print(name,'5 pairs complete',flush=True)
for pair in range(2):
    for variant in ['base','branch']:
        label=f'full-{pair+1}-{variant}'
        destination=out/(label+'.json')
        print(label,'started',flush=True)
        run([str(out/f'nhip-load-research-20261027-{variant}.exe'),str(model),str(destination),'packet'],label)
        value=json.loads(destination.read_text());value.pop('batches',None)
        report['full'].append({'pair':pair+1,'variant':variant,**value});save()
        for previous in report['full']:
            for field in ['sourceSha256','orderedMeshSha256','orderedPacketSha256','colorUpdatesSha256','meshes','vertices','triangles','flatMeshes','instances','templates','packets','packetBytes']:
                assert previous[field]==value[field],(field,previous[field],value[field])
        assert value['stats']['total_csg_failures']==0
        assert value['stats']['geometry_diagnostics']['totalUnsupportedItems']==0
        print(label,round(value['pipelineSeconds'],3),'seconds',flush=True)
report['fullSummary']={variant:{'seconds':[r['pipelineSeconds'] for r in report['full'] if r['variant']==variant],
    'medianSeconds':statistics.median(r['pipelineSeconds'] for r in report['full'] if r['variant']==variant)} for variant in ['base','branch']}
report['fullSummary']['speedupRatio']=report['fullSummary']['base']['medianSeconds']/report['fullSummary']['branch']['medianSeconds']
report['allFullHashesEqual']=True;save()
print(json.dumps(report['fullSummary']),flush=True)
