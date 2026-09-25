"""Summarize the final IFC Temp artifact audit."""

from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "benchmarks" / "results" / "ifc-corpus-20260925"


def main() -> None:
    summary = RESULTS / "final-audit-r3" / "summary.jsonl"
    entries = [json.loads(line) for line in summary.read_text(encoding="utf-8").splitlines()]
    source_root = (Path(os.environ["IFC_TEST_CORPUS_ROOT"])
                   if "IFC_TEST_CORPUS_ROOT" in os.environ
                   else Path(entries[0]["source"]).parent)
    ready = sum(entry["status"] == "ready" for entry in entries)
    lines = [
        "# IFC Temp Engine V2 coverage",
        "",
        f"Final packaged-worker artifact audit: **{ready}/{len(entries)} viewer-ready** IFC files.",
        "This rerun used the 0.8.9-p6.2 self-contained worker bundled with IFC Viewer 1.0.4.",
        "It reused source-bound geometry overrides produced during diagnosis; the seconds below",
        "measure the artifact rerun, not first-time IfcOpenShell conversion or first visible frame.",
        "All files were scanned through the application worker path, including the 1.91 GB",
        "AMTIEN file. The test folder grew from 33 to 34 files during the audit.",
        "",
        "Packaged WebView2 cold opens on the final r5 package passed for GIAN",
        "NANG (8.07 s), the 1.91 GB AMTIEN model (49.37 s), the 883 MB SVD model",
        "(123.45 s), and HANGAR (460.48 s, including 456.11 s conversion and",
        "3.02 s frontend load). The r2 package passed for S3-COMBINE (16.08 s)",
        "and Kien truc (10.87 s).",
        "Earlier package samples also passed for NuiTuyet, POT01, Bison, and",
        "MaiSanh. All were measured from a fresh package cache. HANGAR's first-time",
        "CSG conversion is therefore a serious remaining performance cost. MASCOT",
        "converted 20,364 Boolean items in 354.71 s in a source-side run.",
        "During the r5 SVD conversion, the isolated IfcOpenShell repair process",
        "was observed near 9 GB working set while the desktop process was near",
        "192 MB; the repair process exited before rendering. These are spot",
        "observations, not profiled peaks or a guarantee for other models.",
        "Viewer-ready artifacts do not prove exact WebIFC geometry parity or that",
        "all 34 models have passed a packaged GUI open. Large models show a",
        "product-bounds overview for unloaded regions while exact geometry streams",
        "into a bounded set of resident pages; the overview is not exact geometry.",
        "",
        "| File | Artifact | Rerun seconds |",
        "| --- | --- | ---: |",
    ]
    for entry in entries:
        file_name = Path(entry["source"]).relative_to(source_root)
        lines.append(f"| {file_name} | {entry['status']} | {entry.get('seconds', 0):.2f} |")
    lines.extend(("", "Machine-readable results: `final-audit-r3/summary.jsonl`.", ""))
    (RESULTS / "coverage-report.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
