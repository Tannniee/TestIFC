"""Merge graph and artifact gates into a concise local IFC coverage report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("graph_summary", type=Path)
    parser.add_argument("artifact_summaries", nargs="+", type=Path)
    parser.add_argument("--ready", action="append", default=[],
                        help="A file independently rescanned successfully after the artifact gate")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    graph = rows(args.graph_summary)
    artifacts = {row["source"]: row for path in args.artifact_summaries for row in rows(path)}
    independently_ready = set(args.ready)
    counts = {"viewer ready": 0, "CSG unvalidated": 0, "invalid face/topology": 0, "other": 0}
    table = []
    for item in graph:
        source = item["source"]
        artifact = artifacts.get(source)
        issue = ((artifact or {}).get("error") or "; ".join(item["issues"][:1]))
        if source in independently_ready or artifact and artifact["viewerReady"]:
            status = "viewer ready"
            issue = ""
        elif "Boolean" in issue or "boolean" in issue or "CSG" in issue:
            status = "CSG unvalidated"
        elif "Face" in issue or "face" in issue or "manifold" in issue:
            status = "invalid face/topology"
        else:
            status = "other"
        counts[status] += 1
        detail = issue.replace("|", "\\|").replace("\n", " ")[:180]
        table.append(f"| {source} | {status} | {detail} |")
    content = [
        "# IFC Temp Engine V2 coverage",
        "",
        "Graph planning alone does not prove the viewer can open a file. This report uses",
        "the normal artifact path and counts a file only after a viewer-ready artifact exists.",
        "A viewer-ready artifact is not independent geometric parity proof.",
        "",
        f"Files: {len(graph)}. Viewer ready: {counts['viewer ready']}. "
        f"CSG unvalidated: {counts['CSG unvalidated']}. "
        f"Invalid face/topology: {counts['invalid face/topology']}. Other: {counts['other']}.",
        "",
        "| File | Status | First blocking reason |",
        "| --- | --- | --- |",
        *table,
        "",
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(content), encoding="utf-8")
    print(args.output.resolve())


if __name__ == "__main__":
    main()
