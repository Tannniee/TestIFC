"""Run the versioned IFC backend benchmark contract against a local corpus."""

from __future__ import annotations

import argparse
import json
import platform
import sqlite3
import sys
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import ifcopenshell

import index_builder
import model_index
from content_hash import sha256_file


SCHEMA_VERSION = 1
DEFAULT_MANIFEST = Path(__file__).with_name("corpus.local.json")


def load_manifest(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"schemaVersion must be {SCHEMA_VERSION}")
    models = data.get("models")
    if not isinstance(models, list) or not models:
        raise ValueError("models must be a non-empty array")

    seen: set[str] = set()
    for index, entry in enumerate(models):
        if not isinstance(entry, dict):
            raise ValueError(f"models[{index}] must be an object")
        model_id = entry.get("id")
        if not isinstance(model_id, str) or not model_id.strip():
            raise ValueError(f"models[{index}].id must be a non-empty string")
        if model_id in seen:
            raise ValueError(f"duplicate model id: {model_id}")
        seen.add(model_id)
        if not isinstance(entry.get("path"), str) or not entry["path"].strip():
            raise ValueError(f"models[{index}].path must be a non-empty string")
        expected = entry.get("expectedSha256")
        if expected is not None and (
            not isinstance(expected, str)
            or len(expected) != 64
            or any(character not in "0123456789abcdefABCDEF" for character in expected)
        ):
            raise ValueError(
                f"models[{index}].expectedSha256 must be a 64-character hex digest"
            )
        searches = entry.get("searches", [])
        if not isinstance(searches, list):
            raise ValueError(f"models[{index}].searches must be an array")
        for search_index, search in enumerate(searches):
            if not isinstance(search, dict):
                raise ValueError(
                    f"models[{index}].searches[{search_index}] must be an object"
                )
            limit = search.get("limit", 100)
            if not isinstance(limit, int) or limit < 1 or limit > 500:
                raise ValueError(
                    f"models[{index}].searches[{search_index}].limit must be 1..500"
                )
    return data


def _seconds(started: float) -> float:
    return round(perf_counter() - started, 6)


def _run_model(entry: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    model_path = (manifest_path.parent / entry["path"]).resolve()
    if not model_path.is_file():
        raise FileNotFoundError(f"benchmark model not found: {model_path}")

    started = perf_counter()
    model_hash = sha256_file(model_path)
    hash_seconds = _seconds(started)
    expected = entry.get("expectedSha256")
    if expected is not None and model_hash.lower() != expected.lower():
        raise ValueError(
            f"hash mismatch for {entry['id']}: expected {expected}, got {model_hash}"
        )

    started = perf_counter()
    ifc_file = ifcopenshell.open(str(model_path))
    open_seconds = _seconds(started)
    product_count = len(ifc_file.by_type("IfcProduct"))
    ifc_file = None

    with TemporaryDirectory(prefix="ifc-benchmark-") as temporary:
        cache_dir = Path(temporary)
        started = perf_counter()
        index_builder._worker(str(model_path), model_hash, str(cache_dir))
        prepare_seconds = _seconds(started)
        index_path = model_index.index_path_for(cache_dir, model_hash)
        with closing(sqlite3.connect(index_path)) as connection:
            indexed_elements = int(
                connection.execute("SELECT COUNT(*) FROM element").fetchone()[0]
            )
        index = model_index.ModelIndex(index_path)
        searches = []
        for search in entry.get("searches", []):
            query = str(search.get("query") or "").strip().lower()
            ifc_type = str(search.get("ifcType") or "").strip()
            limit = int(search.get("limit", 100))
            started = perf_counter()
            rows, truncated = index.search(query, ifc_type, limit)
            searches.append(
                {
                    "query": query,
                    "ifcType": ifc_type,
                    "limit": limit,
                    "elapsedSeconds": _seconds(started),
                    "returnedCount": len(rows),
                    "truncated": truncated,
                }
            )

    return {
        "id": entry["id"],
        "path": str(model_path),
        "sha256": model_hash,
        "sizeBytes": model_path.stat().st_size,
        "ifcProductCount": product_count,
        "indexedElementCount": indexed_elements,
        "timings": {
            "sha256Seconds": hash_seconds,
            "ifcOpenSeconds": open_seconds,
            "semanticPrepareSeconds": prepare_seconds,
        },
        "searches": searches,
    }


def run(manifest_path: Path) -> dict[str, Any]:
    manifest = load_manifest(manifest_path)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "ifcopenshell": getattr(ifcopenshell, "version", "unknown"),
        },
        "models": [_run_model(entry, manifest_path) for entry in manifest["models"]],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    load_manifest(manifest_path)
    if args.validate_only:
        print(f"valid benchmark manifest: {manifest_path}")
        return 0

    result = run(manifest_path)
    output = args.output
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output = Path(__file__).with_name("results") / f"baseline-{stamp}.json"
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote benchmark result: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
