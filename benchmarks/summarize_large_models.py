"""Summarize a local run without embedding model filenames or source paths."""
import json
import os
from pathlib import Path
import sys


def main():
    directory = Path(sys.argv[1])
    result = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
    samples = {}
    with (directory / "resources.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            try:
                sample = json.loads(line)
            except ValueError:
                continue
            samples.setdefault(sample.get("model"), []).append(sample)
    rows = []
    for model in result["models"]:
        sample = samples.get(model["id"], [])
        final = model.get("final") or model.get("partial") or model.get("cold") or {}
        runs = final.get("runs") or []
        cold = runs[0] if runs else {}
        warm = runs[1] if len(runs) > 1 else {}
        frames = final.get("frames", {})
        input_frames = final.get("inputToRender", {})
        metrics = cold.get("metrics", {})
        renderer = final.get("renderer", {})
        after_unload = model.get("afterUnload", {}).get("viewer", {}).get("renderer", {})
        gaps = [b["time"] - a["time"] for a, b in zip(sample, sample[1:])]
        semantic_samples = [s for s in sample if s.get("phase") == "semantic-wait"]
        rows.append({
            "id": model["id"], "sizeMB": round(model["sizeBytes"] / 1e6, 1),
            "status": model["status"], "failure": model.get("failure"),
            "geometryReadySeconds": round(cold.get("completedMs", 0) / 1000, 3) if cold.get("done") and not cold.get("error") else None,
            "conversionSeconds": round(metrics.get("conversionMilliseconds", 0) / 1000, 3) if metrics else None,
            "fragmentLoadSeconds": round(metrics.get("fragmentLoadMilliseconds", 0) / 1000, 3) if metrics else None,
            "warmReadySeconds": round(warm.get("completedMs", 0) / 1000, 3) if warm.get("done") and not warm.get("error") else None,
            "warmCacheHit": model.get("warmCacheHit"),
            "fragmentMB": round(metrics["fragmentBytes"] / 1e6, 1) if "fragmentBytes" in metrics else None,
            "peakPrivateGiB": round(max((s["privateBytes"] for s in sample), default=0) / 1024 ** 3, 2),
            "peakWorkingSetSumGiB": round(max((s["workingBytes"] for s in sample), default=0) / 1024 ** 3, 2),
            "peakCpuPercentOfMachine": round(max((s["cpuCoreEquivalents"] for s in sample), default=0) / (os.cpu_count() or 1) * 100, 1),
            "minimumAvailableGiB": round(min((s["availableBytes"] for s in sample), default=0) / 1024 ** 3, 2),
            "resourceSamples": len(sample), "maxResourceGapSeconds": round(max(gaps, default=0), 2),
            "semanticWaitObservedSeconds": round(semantic_samples[-1]["time"] - semantic_samples[0]["time"] + 1, 1) if semantic_samples else 0,
            "orbitP95Ms": frames.get("orbit", {}).get("p95Ms"),
            "orbitP99Ms": frames.get("orbit", {}).get("p99Ms"),
            "orbitMaxMs": frames.get("orbit", {}).get("maxMs"),
            "panP95Ms": frames.get("pan", {}).get("p95Ms"),
            "zoomP95Ms": frames.get("zoom", {}).get("p95Ms"),
            "warmOrbitP95Ms": frames.get("warm-orbit", {}).get("p95Ms"),
            "orbitInputToRenderP95Ms": input_frames.get("orbit", {}).get("p95Ms"),
            "panInputToRenderP95Ms": input_frames.get("pan", {}).get("p95Ms"),
            "zoomInputToRenderP95Ms": input_frames.get("zoom", {}).get("p95Ms"),
            "selectionHit": model.get("selectionHit"), "measurementCount": model.get("measurementCount"),
            "selectionResponseMs": model.get("selectionResponseMs"),
            "drawCallsAtSnapshot": renderer.get("drawCalls"),
            "trianglesAtSnapshot": renderer.get("triangles"),
            "geometriesAtSnapshot": renderer.get("memory", {}).get("geometries"),
            "geometriesAfterUnload": after_unload.get("memory", {}).get("geometries"),
            "pageErrors": model.get("errors"), "consoleWarnings": model.get("warnings"),
            "semanticHashMatchesGeometry": (model.get("runtime", {}).get("activeModelHash") == metrics.get("modelHash")) if metrics else None,
            "semanticHot": model.get("runtime", {}).get("hotIndexStatus"),
            "semanticCold": model.get("runtime", {}).get("coldIndexStatus"),
            "webglRenderer": model.get("webglRenderer"),
        })
    (directory / "comparison.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
