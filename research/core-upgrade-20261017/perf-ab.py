"""Interleaved native qualification; raw probe JSON remains the measurement."""
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess

OUT = Path(__file__).resolve().parent / 'perf-ab'
OUT.mkdir(exist_ok=True)
BASE = Path('F:/Steel/VBA/IFC-Lite')
BRANCH = Path('F:/Steel/VBA/IFC-Lite-Core104')
BASH = 'C:/Users/tanng/AppData/Local/ifclite-build-tools/git/bin/bash.exe'
env = dict(os.environ)
env['PATH'] = 'C:/Users/tanng/.cargo/bin;' + env['PATH']
env['RUSTUP_TOOLCHAIN'] = 'stable'
fixtures = {
    'house': BRANCH / 'tests/models/ara3d/AC20-FZK-Haus.ifc',
    'voids': BRANCH / 'tests/models/ara3d/ISSUE_129_N1540_17_EXE_MOD_448200_02_09_11SMC_IGC_V17.ifc',
}
order = [('base','house'), ('branch','house'), ('branch','voids'), ('base','voids'),
         ('branch','house'), ('base','house'), ('base','voids'), ('branch','voids')]
runs = []
for number, (side, name) in enumerate(order):
    checkout = BASE if side == 'base' else BRANCH
    result = subprocess.run([BASH, '-o', 'igncr', 'scripts/perf/probe.sh', fixtures[name].as_posix(),
                             '--iters', '5', '--json', '--fingerprint'],
                            cwd=checkout, env=env, capture_output=True)
    stem = f'{number:02}-{name}-{side}'
    (OUT / (stem+'.json')).write_bytes(result.stdout)
    (OUT / (stem+'.log')).write_bytes(result.stderr)
    assert result.returncode == 0, (stem, result.stderr[-1500:])
    probe = json.loads(result.stdout)[0]
    runs.append({'side':side, 'fixture':name, 'result':probe})
    print(stem, probe['parseMs'], probe['geometryMs'], probe['totalMs'], flush=True)

summary = {'scope':'native process_geometry, not browser worker-pool or visible-frame latency',
           'source_files': {name:{'path':str(p), 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for name,p in fixtures.items()},
           'fixtures':{}}
for name in fixtures:
    row = {}
    payloads = set()
    counts = set()
    for side in ['base','branch']:
        cohort = [r['result'] for r in runs if r['side']==side and r['fixture']==name]
        wall = [t for p in cohort for t in p['allWallMs']]
        row[side] = {key:statistics.median(p[key] for p in cohort) for key in ['parseMs','geometryMs','totalMs']}
        row[side]['medianFullWallMs'] = statistics.median(wall)
        for p in cohort:
            payloads.update(p['meshFingerprintsFnv1a64'])
            counts.add((p['meshes'],p['vertices'],p['triangles']))
    row['orderedMeshPayloadIdentity'] = len(payloads) == 1 and len(counts) == 1
    row['fingerprints'] = sorted(payloads)
    row['counts'] = sorted(counts)
    row['deltaPercent'] = {key:100*(row['branch'][key]-row['base'][key])/row['base'][key]
                           if row['base'][key] else None for key in row['base']}
    summary['fixtures'][name] = row
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,indent=2))
