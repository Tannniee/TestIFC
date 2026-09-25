"""Measure selective CSG recovery against real IFC corpus files."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import ifcopenshell
from engine_v2_csg import write_csg_overrides


def check(source: Path, output: Path, maximum_items: int) -> dict:
    started = time.perf_counter()
    model = ifcopenshell.open(str(source))
    item_count = len({item.id() for representation in model.by_type("IfcShapeRepresentation")
                      for item in representation.Items if item.is_a("IfcBooleanResult")})
    del model
    result = {"source": str(source), "csgItems": item_count}
    if item_count > maximum_items:
        result["status"] = "skipped-item-limit"
        return result
    output.mkdir(parents=True, exist_ok=True)
    overrides = output / "csg.ifcovr"
    result["convertedItems"] = write_csg_overrides(source, overrides)
    result["csgSeconds"] = round(time.perf_counter() - started, 2)
    worker = ROOT / "engine_v2" / "IfcEngineV2.Scanner" / "bin" / "Release" / "net10.0" / "ifc-engine-v2-scanner.dll"
    command = ["dotnet", str(worker), "scan", str(source), "--manifest", str(output / "scan.json"),
               "--index", str(output / "model.ifc2idx"), "--chunks", str(output / "chunks"),
               "--csg-overrides", str(overrides)]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    result["scanSeconds"] = round(time.perf_counter() - started - result["csgSeconds"], 2)
    result["exitCode"] = completed.returncode
    if completed.returncode:
        result["status"] = "worker-error"
        result["error"] = (completed.stderr or completed.stdout)[:500]
    else:
        manifest = json.loads((output / "scan.json").read_text(encoding="utf-8"))
        result["viewerReady"] = bool((manifest.get("tessellation") or {}).get("viewerReady"))
        result["status"] = "viewer-ready" if result["viewerReady"] else "blocked"
        issues = manifest.get("coverage", {}).get("graph", {}).get("geometryPlan", {}).get("issues", [])
        result["issues"] = issues[:5]
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--maximum-items", type=int, default=1000)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for source in args.sources:
        destination = args.output / source.stem.replace(" ", "-").replace("&", "and")
        try:
            result = check(source.resolve(strict=True), destination, args.maximum_items)
        except Exception as exc:
            result = {"source": str(source), "status": "error", "error": str(exc)[:500]}
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
