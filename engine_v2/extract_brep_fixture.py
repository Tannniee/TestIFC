"""Extract a BRep and its referenced STEP records for isolated geometry diagnosis."""

from __future__ import annotations

import argparse
import json
import mmap
import re
import struct
from pathlib import Path


def extract(source_path: Path, index_path: Path, brep_id: int, output_path: Path,
            dense_ids: bool = False, product: bool = False) -> dict:
    with source_path.open("rb") as source_file, index_path.open("rb") as index_file:
        with mmap.mmap(source_file.fileno(), 0, access=mmap.ACCESS_READ) as source:
            with mmap.mmap(index_file.fileno(), 0, access=mmap.ACCESS_READ) as index:
                def record(express_id: int) -> bytes:
                    position = 4096 + express_id * 16
                    if position + 16 > len(index):
                        raise ValueError(f"Index has no entry for #{express_id}")
                    offset, length, _type_id, present = struct.unpack_from("<qiHH", index, position)
                    if present != 1 or length <= 0:
                        raise ValueError(f"Missing record #{express_id}")
                    value = source[offset:offset + length].strip()
                    if not value.startswith(f"#{express_id}=".encode()):
                        raise ValueError(f"Index entry #{express_id} points to a different record")
                    return value

                root = record(brep_id)
                if not root.startswith(f"#{brep_id}=IFCFACETEDBREP(".encode()):
                    raise ValueError(f"#{brep_id} is not an IfcFacetedBrep")
                records: dict[int, bytes] = {}
                total_bytes = 0
                pending = [brep_id]
                while pending:
                    if len(records) >= 100_000:
                        raise ValueError("BRep fixture exceeds the 100,000-record diagnostic limit")
                    express_id = pending.pop()
                    if express_id in records:
                        continue
                    value = record(express_id)
                    if len(value) > 16 * 1024 * 1024:
                        raise ValueError(f"Record #{express_id} exceeds the diagnostic size limit")
                    total_bytes += len(value)
                    if total_bytes > 100 * 1024 * 1024:
                        raise ValueError("BRep fixture exceeds the 100 MiB diagnostic limit")
                    records[express_id] = value
                    pending.extend(
                        int(match) for match in re.findall(rb"#(\d+)", value.split(b"=", 1)[1])
                        if int(match) not in records
                    )

    header = (
        b"ISO-10303-21;\nHEADER;\n"
        b"FILE_DESCRIPTION(('Isolated BRep geometry diagnostic'),'2;1');\n"
        b"FILE_NAME('isolated-brep.ifc','2026-09-23T00:00:00',('Engine V2 research'),"
        b"('Engine V2 research'),'Codex','Codex','');\n"
        b"FILE_SCHEMA(('IFC2X3'));\nENDSEC;\nDATA;\n"
    )
    id_map = {express_id: index + 1 for index, express_id in enumerate(sorted(records))} if dense_ids else {}
    fixture_brep_id = id_map.get(brep_id, brep_id)
    product_id = None
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as output:
        output.write(header)
        for express_id in sorted(records):
            value = records[express_id]
            if dense_ids:
                value = re.sub(rb"#(\d+)", lambda match: f"#{id_map[int(match.group(1))]}".encode(), value)
            output.write(value)
            output.write(b"\n")
        if product:
            first = max(id_map.values()) + 1 if dense_ids else max(records) + 1
            product_id = first + 6
            additions = [
                f"#{first}=IFCCARTESIANPOINT((0.,0.,0.));",
                f"#{first + 1}=IFCAXIS2PLACEMENT3D(#{first},$,$);",
                f"#{first + 2}=IFCLOCALPLACEMENT($,#{first + 1});",
                f"#{first + 3}=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#{first + 1},$);",
                f"#{first + 4}=IFCSHAPEREPRESENTATION(#{first + 3},'Body','Brep',(#{fixture_brep_id}));",
                f"#{first + 5}=IFCPRODUCTDEFINITIONSHAPE($,$,(#{first + 4}));",
                f"#{product_id}=IFCWALL('isolation-guid',$,'Fixture',$,$,#{first + 2},#{first + 5},$);",
                f"#{first + 7}=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
                f"#{first + 8}=IFCUNITASSIGNMENT((#{first + 7}));",
            ]
            for addition in additions:
                output.write(addition.encode("ascii") + b"\n")
        output.write(b"ENDSEC;\nEND-ISO-10303-21;\n")
    return {"brepId": brep_id, "fixtureBrepId": fixture_brep_id,
            "fixtureProductId": product_id,
            "denseIds": dense_ids, "records": len(records), "bytes": output_path.stat().st_size,
            "output": str(output_path.resolve())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("index", type=Path)
    parser.add_argument("brep_id", type=int)
    parser.add_argument("output", type=Path)
    parser.add_argument("--dense", action="store_true", help="Remap STEP IDs to 1..N")
    parser.add_argument("--product", action="store_true", help="Wrap the BRep in a test product")
    arguments = parser.parse_args()
    print(json.dumps(extract(arguments.source, arguments.index, arguments.brep_id,
                             arguments.output, arguments.dense, arguments.product), indent=2))
