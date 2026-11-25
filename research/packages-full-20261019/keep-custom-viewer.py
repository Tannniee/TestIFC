from pathlib import Path
import subprocess
import hashlib
import json

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
start = 'c95361aa572694ecdd6f1e75c50e38b09d4bd593'
tracked = set(subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', start, 'apps/viewer/'], cwd=root, text=True).splitlines())
owned = {}
for name in ['flow-integration-plan.json', 'support-integration-plan.json']:
    for change in json.loads((out / name).read_text())['changes']:
        path = change['path']
        if path.startswith('apps/viewer/'):
            owned[path] = change['sha256']
target = '61d209288c1b117d405628ead302d0ee700bd2a0'
for path in json.loads((out / 'missing-viewer-imports.json').read_text())['imported']:
    if path not in owned:
        source = subprocess.check_output(['git', 'show', f'{target}:{path}'], cwd=root)
        owned[path] = hashlib.sha256(source).hexdigest()
restore = []
for path, expected in owned.items():
    if path == 'apps/viewer/src/hooks/ids/idsWorkerClient.ts' or path.startswith('apps/viewer/src/workers/idsValidation.worker'):
        continue
    destination = (root / path).resolve()
    if not destination.is_relative_to(root / 'apps/viewer'):
        raise RuntimeError('Path outside the owned viewer integration scope')
    actual = destination.read_bytes().replace(b'\r\n', b'\n') if destination.exists() else None
    original = subprocess.check_output(['git', 'show', f'{start}:{path}'], cwd=root) if path in tracked else None
    if actual == original:
        continue
    if actual is not None and hashlib.sha256(actual).hexdigest() != expected:
        raise RuntimeError(f'An unrecorded edit must be preserved: {path}')
    restore.append(path)
for path in restore:
    destination = root / path
    if path in tracked:
        source = subprocess.check_output(['git', 'show', f'{start}:{path}'], cwd=root)
        staged = destination.with_name(destination.name + '.restore-tmp')
        staged.write_bytes(source)
        staged.replace(destination)
    elif destination.exists():
        destination.unlink()
manifest = root / 'apps/viewer/package.json'
current = json.loads(manifest.read_text())
original_bytes = subprocess.check_output(['git', 'show', f'{start}:apps/viewer/package.json'], cwd=root)
original = json.loads(original_bytes)
for name in ['ai', 'ids-agent', 'ids-authoring', 'semantic', 'report-contract', 'source-autodesk']:
    current['dependencies'].pop('@ifc-lite/' + name, None)
if current != original:
    raise RuntimeError('Unexpected viewer manifest change')
manifest.write_bytes(original_bytes)
(out / 'custom-viewer-scope.json').write_text(json.dumps({'restored_custom_viewer_paths': restore,
    'reason': 'Retain the customized UI and adapt its actual library contracts. Full upstream Flow/content workbench UI is a separate product/UI migration; all 62 library sources and behavior tests remain integrated.'}, indent=2))
print(f'Retained custom UI; restored {len(restore)} paths from the recorded integration experiment.')
