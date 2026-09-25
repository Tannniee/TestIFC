"""Exercise the app's native conversion mode for graph-complete IFC corpus files.

Results are resumable. A graph-complete file is counted as ready only when the
normal worker produces a viewer-ready tessellation artifact.
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
    parser.add_argument("graph_summary", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--scanner", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--previous", type=Path,
                        help="Skip files already proven viewer-ready in an earlier artifact gate")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    summary_path = args.output / "summary.jsonl"
    completed = {
        json.loads(line)["source"]
        for line in summary_path.read_text(encoding="utf-8").splitlines()
    } if summary_path.exists() else set()
    previously_ready = {
        json.loads(line)["source"]
        for line in args.previous.read_text(encoding="utf-8").splitlines()
        if json.loads(line)["viewerReady"]
    } if args.previous else set()
    rows = [json.loads(line) for line in args.graph_summary.read_text(encoding="utf-8").splitlines()]
    for ordinal, row in enumerate(rows, 1):
        relative = row["source"]
        if (relative in completed or relative in previously_ready or
                row["graphStatus"] != "complete" or row["planStatus"] != "complete"):
            continue
        source = args.source / relative
        directory = args.output / f"{ordinal:02d}"
        directory.mkdir(exist_ok=True)
        large = source.stat().st_size > 1_073_741_824
        manifest_path = directory / ("probe.json" if large else "scan.json")
        command = [str(args.scanner), "probe" if large else "scan", str(source)]
        if large:
            command += ["--output", str(manifest_path), "--index", str(directory / "model.ifc2idx"),
                        "--check-graph", "--chunks", str(directory / "chunks")]
        else:
            command += ["--manifest", str(manifest_path), "--index", str(directory / "model.ifc2idx"),
                        "--chunks", str(directory / "chunks")]
        started = time.monotonic()
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=args.timeout, check=False)
            exit_code = result.returncode
            error = result.stderr.strip()
        except subprocess.TimeoutExpired:
            exit_code = -1
            error = f"Timed out after {args.timeout}s"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
        tessellation = manifest.get("Tessellation" if large else "tessellation") or {}
        ready = bool(tessellation.get("ViewerReady" if large else "viewerReady"))
        if not ready and not error:
            if large:
                graph = manifest.get("GraphValidation") or {}
                issues = [*(graph.get("Issues") or []), *((graph.get("GeometryPlan") or {}).get("Issues") or [])]
            else:
                issues = (manifest.get("coverage") or {}).get("reasons") or []
            error = "; ".join(str(issue) for issue in issues[:8]) or "No viewer-ready artifact was produced"
        record = {
            "source": relative,
            "bytes": source.stat().st_size,
            "elapsedSeconds": round(time.monotonic() - started, 3),
            "exitCode": exit_code,
            "viewerReady": ready,
            "triangles": tessellation.get("Triangles" if large else "triangles"),
            "error": error[:2000],
        }
        with summary_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(json.dumps(record, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
