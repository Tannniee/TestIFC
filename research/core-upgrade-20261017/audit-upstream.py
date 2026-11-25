"""Read-only tree comparison and dry three-way merges for core-upgrade research."""
from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BASE = "e79f27342beb01a6f30d9b63c44795ecd118f4de"
TARGETS = {
    "production": "61d209288c1b117d405628ead302d0ee700bd2a0",
    "main": "74d097d01f96df892ffa09e69c5c82e628be7d5c",
}


def git(*args: str, check: bool = True) -> bytes:
    result = subprocess.run(
        ["git", "-c", "core.autocrlf=false", *args], cwd=ROOT,
        capture_output=True, check=check,
    )
    return result.stdout


def paths(*args: str) -> set[str]:
    return set(git(*args).decode("utf-8").splitlines())


def blob(ref: str, path: str) -> bytes:
    return git("show", f"{ref}:{path}")


def digest(path: Path) -> str:
    return hashlib.file_digest(path.open("rb"), "sha256").hexdigest()


def versions(ref: str | None) -> dict[str, str]:
    result = {}
    for path in ["package.json", "apps/viewer/package.json", *[
        f"packages/{name}/package.json" for name in
        ("wasm", "geometry", "parser", "renderer", "data", "spatial", "export")
    ]]:
        raw = blob(ref, path) if ref else (ROOT / path).read_bytes()
        result[path] = json.loads(raw)["version"]
    cargo = blob(ref, "Cargo.toml") if ref else (ROOT / "Cargo.toml").read_bytes()
    section = cargo.decode().split("[workspace.package]", 1)[1].split("[", 1)[0]
    result["Cargo.toml:workspace.package"] = next(
        line.split('"')[1] for line in section.splitlines() if line.startswith("version")
    )
    return result


tracked = paths("diff", "--name-only", "HEAD")
untracked = paths("ls-files", "--others", "--exclude-standard")
local_changes = paths("diff", "--name-only", BASE)
base_tree = paths("ls-tree", "-r", "--name-only", BASE)
protected_paths = sorted(
    p for p in tracked | untracked if not p.startswith("research/")
    and (ROOT / p).is_file()
)
fingerprints = {p: digest(ROOT / p) for p in protected_paths}
report = {
    "checked_utc": datetime.now(timezone.utc).isoformat(),
    "root": str(ROOT),
    "branch": git("branch", "--show-current").decode().strip(),
    "head": git("rev-parse", "HEAD").decode().strip(),
    "origin": git("remote", "get-url", "origin").decode().strip(),
    "shallow": git("rev-parse", "--is-shallow-repository").decode().strip(),
    "base": BASE,
    "tracked_modified_vs_head": len(tracked),
    "untracked_before_audit_excluding_this_folder": len([
        p for p in untracked if not p.startswith("research/core-upgrade-20261017/")
    ]),
    "tracked_local_delta_vs_base": len(local_changes),
    "local_versions": versions(None),
    "source_fingerprints": fingerprints,
    "targets": {},
    "limits": [
        "Tree/content comparison does not require a complete ancestry in the shallow checkout.",
        "Dry three-way merge is text compatibility only, not compilation or runtime evidence.",
        "No worktree merge, dependency install, app build or application test is performed.",
        "A version match does not establish source identity; main and production are compared separately.",
    ],
}

for name, ref in TARGETS.items():
    target_tree = paths("ls-tree", "-r", "--name-only", ref)
    upstream_changes = paths("diff", "--name-only", BASE, ref)
    overlap = sorted(local_changes & upstream_changes)
    collisions = sorted(untracked & target_tree)
    merges = []
    for path in overlap:
        if path not in base_tree or path not in target_tree or not (ROOT / path).is_file():
            merges.append({"path": path, "status": "add/delete/review"})
            continue
        current = (ROOT / path).read_bytes()
        original, incoming = blob(BASE, path), blob(ref, path)
        if any(b"\0" in b for b in (current, original, incoming)):
            merges.append({"path": path, "status": "binary/review"})
            continue
        with tempfile.TemporaryDirectory(prefix="ifclite-merge-research-") as temp:
            files = [Path(temp) / n for n in ("current", "base", "upstream")]
            for file, content in zip(files, (current, original, incoming)):
                file.write_bytes(content.replace(b"\r\n", b"\n"))
            merged = subprocess.run(
                ["git", "merge-file", "-p", "--diff3", *map(str, files)],
                capture_output=True,
            )
        status = "clean-text-merge" if merged.returncode == 0 else (
            "text-conflict" if 0 < merged.returncode <= 127 else "merge-error"
        )
        merges.append({"path": path, "status": status,
                       "conflict_regions": merged.stdout.count(b"<<<<<<< ")})
    per_area = {}
    for path in upstream_changes:
        parts = path.split("/")
        area = "/".join(parts[:2]) if parts[0] in ("rust", "packages", "apps") else parts[0]
        per_area[area] = per_area.get(area, 0) + 1
    report["targets"][name] = {
        "ref": ref,
        "commit": git("show", "-s", "--format=%H %cI %s", ref).decode().strip(),
        "versions": versions(ref),
        "upstream_changed_paths_vs_base": len(upstream_changes),
        "upstream_changes_by_area": dict(sorted(per_area.items())),
        "local_overlap_count": len(overlap),
        "untracked_path_collisions": collisions,
        "dry_merges": merges,
        "text_conflict_file_count": sum(m["status"] == "text-conflict" for m in merges),
    }

exe = ROOT / "desktop/release/10.3.0-native-quality-audit-20261017/IFC-Lite.exe"
report["protected_exe"] = {"path": str(exe), "sha256": digest(exe), "bytes": exe.stat().st_size}
report["source_unchanged_during_audit"] = all(
    (ROOT / path).is_file() and digest(ROOT / path) == sha
    for path, sha in fingerprints.items()
)
(OUT / "evidence.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps({
    "local_versions": report["local_versions"],
    "tracked_modified": len(tracked),
    "local_delta_vs_base": len(local_changes),
    "source_unchanged_during_audit": report["source_unchanged_during_audit"],
    "protected_exe": report["protected_exe"],
    "targets": {name: {
        k: v for k, v in item.items() if k in (
            "ref", "versions", "upstream_changed_paths_vs_base", "local_overlap_count",
            "untracked_path_collisions", "text_conflict_file_count"
        )
    } for name, item in report["targets"].items()},
}, indent=2))
