"""Inventory Engine V2 graph coverage for a local IFC folder without writing chunks.

This probe is a diagnostic gate. A complete graph plan still requires the normal
artifact and viewer checks before a model can be called fully supported.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--scanner", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--max-bytes", type=int, default=2_000_000_000)
    args = parser.parse_args()

    files = sorted(
        (p for p in args.source.rglob("*.ifc") if p.is_file() and p.stat().st_size <= args.max_bytes),
        key=lambda p: (p.stat().st_size, str(p).lower()),
    )
    args.output.mkdir(parents=True, exist_ok=True)
    summary_path = args.output / "summary.jsonl"
    completed: set[str] = set()
    if summary_path.exists():
        for line in summary_path.read_text(encoding="utf-8").splitlines():
            completed.add(json.loads(line)["source"])
    for number, source in enumerate(files, 1):
        relative = str(source.relative_to(args.source))
        if relative in completed:
            continue
        directory = args.output / f"{number:02d}"
        directory.mkdir(exist_ok=True)
        probe_path = directory / "probe.json"
        index_path = directory / "source.ifc2idx"
        command = [str(args.scanner), "probe", str(source), "--output", str(probe_path),
                   "--index", str(index_path), "--check-graph"]
        started = time.monotonic()
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=args.timeout, check=False)
            exit_code = result.returncode
            stderr = result.stderr.strip()
        except subprocess.TimeoutExpired as error:
            exit_code = -1
            stderr = f"Timed out after {args.timeout}s: {error}"
        probe = json.loads(probe_path.read_text(encoding="utf-8")) if probe_path.exists() else {}
        graph = probe.get("GraphValidation") or {}
        plan = graph.get("GeometryPlan") or {}
        record = {
            "source": relative,
            "bytes": source.stat().st_size,
            "elapsedSeconds": round(time.monotonic() - started, 3),
            "exitCode": exit_code,
            "graphStatus": graph.get("Status"),
            "planStatus": plan.get("Status"),
            "issues": (plan.get("Issues") or graph.get("Issues") or [])[:16],
            "error": stderr[:4000],
        }
        with summary_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(json.dumps(record, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
