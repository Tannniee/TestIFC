"""Pixel oracle: camera motion must not repaint a covering panel."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

folder = Path(__file__).parent / sys.argv[1]
pairs = [("default", "surface-orbit")]
pairs.extend((name, "surface-" + name) for name in ("light", "dark", "colorful") if (folder / ("surface-" + name + "-a.png")).exists())
reports = []
for name, stem in pairs:
    first = Image.open(folder / (stem + "-a.png")).convert("RGB")
    second = Image.open(folder / (stem + "-b.png")).convert("RGB")
    assert first.size == second.size
    delta = ImageChops.difference(first, second).tobytes()
    changed = sum(any(delta[i:i + 3]) for i in range(0, len(delta), 3))
    report = {"theme": name, "size": first.size, "pixels": first.width * first.height, "changed_pixels": changed}
    reports.append(report)
    if "--expect-change" in sys.argv:
        assert changed > 0, "baseline must demonstrate model leakage"
    else:
        assert changed == 0, f"{name}: camera motion changed {changed} pixels behind the panel"
(folder / "pixel-oracle.json").write_text(json.dumps(reports, indent=2))
print(json.dumps(reports))
