from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
source = subprocess.check_output(['git', 'show', '61d209288c1b117d405628ead302d0ee700bd2a0:tsconfig.json'], cwd=root)
(root / 'tsconfig.json').write_bytes(source)
