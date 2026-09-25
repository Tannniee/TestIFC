"""Read a few IFC face rings through an Engine V2 v2 index for diagnosis only."""

from __future__ import annotations

import json
import mmap
import re
import struct
import sys
from pathlib import Path


def main(source_path: Path, index_path: Path, face_ids: list[int]) -> None:
    with source_path.open("rb") as source_file, index_path.open("rb") as index_file:
        with mmap.mmap(source_file.fileno(), 0, access=mmap.ACCESS_READ) as source:
            with mmap.mmap(index_file.fileno(), 0, access=mmap.ACCESS_READ) as index:
                def record(express_id: int) -> bytes:
                    offset, length, _type_id, present = struct.unpack_from("<qiHH", index, 4096 + express_id * 16)
                    if present != 1 or length <= 0:
                        raise ValueError(f"Missing record #{express_id}")
                    return source[offset:offset + length]

                def refs(value: bytes) -> list[int]:
                    return [int(match) for match in re.findall(rb"#(\d+)", value.split(b"=", 1)[1])]

                def point(express_id: int) -> tuple[float, float, float]:
                    value = record(express_id)
                    match = re.search(rb"IFCCARTESIANPOINT\(\(([^)]*)\)\)", value)
                    if not match:
                        raise ValueError(f"Invalid point #{express_id}")
                    numbers = [float(part) for part in match.group(1).split(b",")]
                    return numbers[0], numbers[1], numbers[2] if len(numbers) > 2 else 0.0

                output = []
                for face_id in face_ids:
                    rings = []
                    for bound_id in refs(record(face_id)):
                        bound = record(bound_id)
                        loop_id = refs(bound)[0]
                        vertices = [point(value) for value in refs(record(loop_id))]
                        ring = {
                            "boundId": bound_id,
                            "loopId": loop_id,
                            "outer": bool(re.match(rb"#\s*\d+\s*=\s*IFCFACEOUTERBOUND", bound)),
                            "points": len(vertices),
                            "first": vertices[0],
                            "bounds": [[min(p[axis] for p in vertices), max(p[axis] for p in vertices)] for axis in range(3)],
                            "vertices": vertices,
                        }
                        rings.append(ring)
                    output.append({"faceId": face_id, "rings": rings})
                print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), [int(value) for value in sys.argv[3:]])
