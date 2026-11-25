from pathlib import Path, PurePosixPath
import subprocess
import json
import re

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
target = '61d209288c1b117d405628ead302d0ee700bd2a0'
target_files = set(subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', target, 'apps/viewer/'], cwd=root, text=True).splitlines())
seeds = []
for name in ['flow-integration-plan.json', 'support-integration-plan.json']:
    plan = json.loads((out / name).read_text())
    seeds += [item['path'] for item in plan['changes'] if item['path'].startswith('apps/viewer/') and item['path'].endswith(('.ts', '.tsx'))]
queue = list(seeds)
seen, imported, unresolved = set(), [], []

def resolve(source, specifier):
    base = (root / 'apps/viewer/src' / specifier[2:]) if specifier.startswith('@/') else root / PurePosixPath(source).parent / specifier
    base = base.resolve().relative_to(root).as_posix()
    stem = base[:-3] if base.endswith('.js') else base
    return [stem + extension for extension in ['', '.ts', '.tsx', '/index.ts', '/index.tsx']]

def copy(path):
    destination = root / path
    if destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(subprocess.check_output(['git', 'show', f'{target}:{path}'], cwd=root))
    imported.append(path)
    queue.append(path)
    if path.endswith(('.ts', '.tsx')) and not '.test.' in path:
        stem = path.rsplit('.', 1)[0]
        for test in [stem + '.test.ts', stem + '.test.tsx']:
            if test in target_files:
                copy(test)

while queue:
    path = queue.pop()
    if path in seen or not (root / path).exists():
        continue
    seen.add(path)
    text = (root / path).read_text(encoding='utf-8')
    specifiers = re.findall(r'''(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']''', text)
    for specifier in specifiers:
        if not specifier.startswith(('.', '@/')):
            continue
        candidates = resolve(path, specifier)
        if any((root / candidate).is_file() for candidate in candidates):
            continue
        dependency = next((candidate for candidate in candidates if candidate in target_files), None)
        if dependency:
            copy(dependency)
        else:
            unresolved.append({'source': path, 'specifier': specifier})
report = {'imported': imported, 'unresolved': unresolved, 'scanned_files': len(seen)}
(out / 'missing-viewer-imports.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
