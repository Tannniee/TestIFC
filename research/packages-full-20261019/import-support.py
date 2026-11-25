from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
target = '61d209288c1b117d405628ead302d0ee700bd2a0'
for name in ['apps/viewer/src/test/bcf-http-server.ts', 'scripts/lib/bim-derived-type-groups.mjs']:
    data = subprocess.check_output(['git', 'show', f'{target}:{name}'], cwd=root)
    destination = root / name
    if destination.exists() and destination.read_bytes().replace(b'\r\n', b'\n') == data:
        continue
    if destination.exists() and name != 'scripts/lib/bim-derived-type-groups.mjs':
        raise RuntimeError(f'Refusing to replace existing support source: {name}')
    destination.write_bytes(data)
