from pathlib import Path
import json
import sys
from PIL import Image, ImageChops

folder = Path(sys.argv[1])
reports = []
for first_path in sorted(folder.glob('surface-*-a.png')):
    second_path = first_path.with_name(first_path.name.replace('-a.png', '-b.png'))
    first = Image.open(first_path).convert('RGB')
    second = Image.open(second_path).convert('RGB')
    assert first.size == second.size
    delta = ImageChops.difference(first, second).tobytes()
    changed = sum(any(delta[i:i+3]) for i in range(0, len(delta), 3))
    reports.append({'theme': first_path.stem.removeprefix('surface-').removesuffix('-a'),
                    'size': first.size, 'changed_pixels': changed})
    assert changed == 0, reports[-1]
assert len(reports) == 3
(folder / 'pixel-oracle.json').write_text(json.dumps(reports, indent=2))
print(json.dumps(reports))
