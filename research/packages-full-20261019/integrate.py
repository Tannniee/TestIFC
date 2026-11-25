from pathlib import Path
import subprocess
import json
import tempfile
import hashlib
import sys
import re

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BASE = 'e79f27342beb01a6f30d9b63c44795ecd118f4de'
TARGET = '61d209288c1b117d405628ead302d0ee700bd2a0'
START = 'c95361aa572694ecdd6f1e75c50e38b09d4bd593'
scopes = [sys.argv[i + 1] for i, argument in enumerate(sys.argv) if argument == '--scope']
closure = json.loads((ROOT / 'research/core-upgrade-20261017/dependency-closure.json').read_text())['runtime_workspace_closure']

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def tree(ref):
    roots = sorted({scope.split('/')[0] for scope in scopes}) if scopes else ['packages/']
    rows = git('ls-tree', '-r', '-z', ref, *roots).split(b'\0')
    return {path.decode(): meta.split()[2].decode() for row in rows if row for meta, path in [row.split(b'\t', 1)]
            if not scopes or any(path.decode().startswith(scope) for scope in scopes)}

def blobs(hashes):
    unique = sorted(set(hashes))
    data = subprocess.run(['git', 'cat-file', '--batch'], cwd=ROOT, input=('\n'.join(unique) + '\n').encode(), stdout=subprocess.PIPE, check=True).stdout
    result = {}
    pos = 0
    for oid in unique:
        end = data.index(b'\n', pos)
        header = data[pos:end].split()
        size = int(header[2])
        result[oid] = data[end+1:end+1+size]
        pos = end + 1 + size + 1
    return result

base_tree, target_tree, current_tree = tree(BASE), tree(TARGET), tree(START)
content = blobs(list(base_tree.values()) + list(target_tree.values()) + list(current_tree.values()))
excluded = set()
packages = []
for path, oid in target_tree.items():
    if path.count('/') == 2 and path.endswith('/package.json'):
        pkg = json.loads(content[oid])
        packages.append({'name': pkg['name'], 'version': pkg['version'], 'directory': path.rsplit('/', 1)[0]})
        if pkg['name'] in closure:
            excluded.add(path.rsplit('/', 1)[0])

changes, conflicts = [], []
prepared = {}
for path in sorted(set(base_tree) | set(target_tree) | set(current_tree)):
    if any(path.startswith(directory + '/') for directory in excluded):
        continue
    base = content.get(base_tree.get(path))
    target = content.get(target_tree.get(path))
    current = content.get(current_tree.get(path))
    if target == base or current == target:
        continue
    if path == 'docs/api/typescript.md':
        # This is the matching upstream public guide; the package table is
        # regenerated from all 62 actual manifests after integration.
        merged = target
        strategy = 'matching-public-guide-with-regenerated-package-table'
    elif path == 'packages/collab-server/test/access-control.test.ts':
        # Production now uses the same obstructed temporary-file destination
        # on every OS, superseding our Windows-only port without losing the
        # existing flush failure/recovery assertions.
        merged = target
        strategy = 'upstream-cross-platform-fixture-supersedes-local-port'
    elif current == base:
        merged = target
        strategy = 'upstream'
    elif base is None and current is None:
        merged = target
        strategy = 'new'
    elif target is None:
        conflicts.append({'path': path, 'reason': 'upstream removed a locally modified file'})
        continue
    elif current is None:
        conflicts.append({'path': path, 'reason': 'local deletion and upstream modification'})
        continue
    elif b'\0' in (base or b'') + target + current:
        conflicts.append({'path': path, 'reason': 'both changed binary data'})
        continue
    else:
        with tempfile.TemporaryDirectory(prefix='ifclite-pkg-merge-') as folder:
            inputs = [Path(folder) / name for name in ['current', 'base', 'target']]
            for item, value in zip(inputs, [current, base or b'', target]):
                item.write_bytes(value)
            result = subprocess.run(['git', 'merge-file', '-p', '-L', 'custom-desktop', '-L', 'original-upstream', '-L', 'production-packages', *map(str, inputs)], cwd=ROOT, stdout=subprocess.PIPE)
            merged = result.stdout
        strategy = 'three-way'
        if result.returncode and path == 'apps/viewer/src/i18n/en.ts':
            def keep_both_catalogues(match):
                left, right = match.group(1), match.group(2)
                if not ('desktopShellEn' in left or 'testIfcEn' in left) or 'semantic' not in right:
                    raise RuntimeError('Unexpected English catalogue conflict')
                return left + right
            text = merged.decode('utf-8')
            text = re.sub(r'(?ms)^<<<<<<<[^\n]*\n(.*?)^=======\n(.*?)^>>>>>>>[^\n]*\n', keep_both_catalogues, text)
            if '<<<<<<<' in text:
                raise RuntimeError('Unresolved English catalogue conflict')
            merged = text.encode('utf-8')
            result.returncode = 0
            strategy = 'three-way-preserve-desktop-and-new-catalogues'
        if result.returncode:
            conflict_file = OUT / 'conflicts' / path
            conflict_file.parent.mkdir(parents=True, exist_ok=True)
            conflict_file.write_bytes(merged)
            conflicts.append({'path': path, 'reason': 'content conflict', 'preview': str(conflict_file)})
            continue
    if merged == current:
        continue
    prepared[path] = merged
    changes.append({'path': path, 'strategy': strategy, 'action': 'delete' if merged is None else 'add' if current is None else 'modify',
                    'sha256': hashlib.sha256(merged).hexdigest() if merged is not None else None})

report = {'base': BASE, 'target': TARGET, 'starting_head': START, 'already_integrated_core_packages': closure,
    'target_packages': sorted(packages, key=lambda p: p['name']), 'changes': changes, 'conflicts': conflicts}
(OUT / ('support-integration-plan.json' if scopes else 'integration-plan.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'target_packages': len(packages), 'already_integrated_core_packages': len(closure),
    'changed_files': len(changes), 'conflicts': conflicts}, indent=2))
if '--apply' in sys.argv:
    if conflicts:
        raise SystemExit('Resolve the preflight conflicts before applying this migration.')
    for path, merged in prepared.items():
        destination = (ROOT / path).resolve()
        if not destination.is_relative_to(ROOT.resolve()) or (not scopes and not destination.is_relative_to(ROOT.resolve() / 'packages')):
            raise RuntimeError('Migration path escaped the selected workspace scope')
        expected = content.get(current_tree.get(path))
        actual = destination.read_bytes().replace(b'\r\n', b'\n') if destination.exists() else None
        if actual == merged:
            continue
        if actual != expected:
            raise RuntimeError(f'Unrecorded source change: {path}')
    for path, merged in prepared.items():
        destination = ROOT / path
        if merged is None:
            destination.unlink()
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(merged)
    print('Applied the recorded package migration.')
