"""Run every local IFC through the application's Engine V2 artifact worker."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from engine_v2_jobs import EngineV2JobManager


def file_hash(source: Path) -> bytes:
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.digest()


def seed_index(root: Path, output: Path) -> dict[bytes, Path]:
    choices: dict[bytes, tuple[int, int, Path]] = {}
    for candidate in root.rglob("*.ifcovr"):
        if output in candidate.parents:
            continue
        with candidate.open("rb") as stream:
            header = stream.read(44)
        if len(header) != 44 or header[:8] != b"IFCOVR01":
            continue
        count = int.from_bytes(header[40:44], "little", signed=True)
        if count < 0:
            continue
        value = (count, candidate.stat().st_size, candidate)
        if header[8:40] not in choices or value[:2] > choices[header[8:40]][:2]:
            choices[header[8:40]] = value
    return {digest: value[2] for digest, value in choices.items()}


def run_one(source: Path, output: Path, seed: Path | None) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    if seed is not None:
        shutil.copyfile(seed, output / "geometry-overrides.ifcovr")
    start = time.perf_counter()
    result = {"source": str(source), "bytes": source.stat().st_size}
    try:
        EngineV2JobManager._run_worker(source, output, threading.Event())
        manifest_file = output / ("probe.json" if source.stat().st_size > 1024 ** 3 else "scan-manifest.json")
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        tessellation = manifest.get("Tessellation") if manifest_file.name == "probe.json" else manifest.get("tessellation")
        result["viewerReady"] = bool(tessellation.get("ViewerReady") if manifest_file.name == "probe.json"
                                     else tessellation.get("viewerReady"))
        result["status"] = "ready" if result["viewerReady"] else "blocked"
    except Exception as exc:
        result["status"] = "error"
        result["error"] = str(exc)[:500]
    result["seconds"] = round(time.perf_counter() - start, 2)
    return result


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--seed-root", type=Path)
    parser.add_argument("--single", type=Path)
    parser.add_argument("--seed", type=Path)
    args = parser.parse_args()
    if args.single:
        print(json.dumps(run_one(args.single, args.output, args.seed), ensure_ascii=False), flush=True)
        return
    if not args.source_root or not args.seed_root:
        parser.error("--source-root and --seed-root are required for a corpus run")
    source_root = args.source_root.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    seeds = seed_index(args.seed_root.resolve(strict=True), output)
    summary = output / "summary.jsonl"
    completed = {}
    if summary.exists():
        for line in summary.read_text(encoding="utf-8").splitlines():
            entry = json.loads(line)
            completed[entry["source"]] = entry
    for source in sorted(source_root.rglob("*.ifc")):
        source = source.resolve(strict=True)
        if completed.get(str(source), {}).get("status") == "ready":
            print(json.dumps(completed[str(source)], ensure_ascii=False), flush=True)
            continue
        digest = file_hash(source)
        destination = output / digest.hex()[:16]
        seed = seeds.get(digest)
        command = [sys.executable, str(Path(__file__).resolve()), "--single", str(source),
                   "--output", str(destination)]
        if seed is not None:
            command.extend(("--seed", str(seed)))
        process = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                                 errors="replace", check=False)
        if process.returncode:
            result = {"source": str(source), "status": "process-error", "error": process.stderr[:500]}
        else:
            result = json.loads(process.stdout)
        print(json.dumps(result, ensure_ascii=False), flush=True)
        with summary.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(result, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
