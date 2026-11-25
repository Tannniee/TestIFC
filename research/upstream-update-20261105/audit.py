"""Read-only upstream inventory and text-merge study; never changes application files."""
from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import tomllib
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
SOURCE = Path("F:/Steel/VBA/IFC-Lite-Core104")
BASE = "61d209288c1b117d405628ead302d0ee700bd2a0"
UI_BASE = "e79f27342beb01a6f30d9b63c44795ecd118f4de"
TARGETS = {
    "production": "7ef97b25c6d7e9ee1a28ffc2f39185cfa206cd99",
    "main": "2cf5d2fa7f7831aa8282c944d7a2a67fa3cf878e",
}


def git(*args: str, root: Path = SOURCE) -> bytes:
    return subprocess.run(
        ["git", "-c", "core.autocrlf=false", *args], cwd=root,
        capture_output=True, check=True,
    ).stdout


def paths(*args: str, root: Path = SOURCE) -> set[str]:
    return set(git(*args, root=root).decode("utf-8").splitlines())


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshot(root: Path) -> dict:
    entries = git(
        "ls-files", "--cached", "--others", "--exclude-standard", "-z",
        "--", ".", ":(exclude)research", root=root,
    ).decode("utf-8").split("\0")
    return {
        "head": git("rev-parse", "HEAD", root=root).decode().strip(),
        "branch": git("branch", "--show-current", root=root).decode().strip(),
        "index_sha256": digest(Path(git("rev-parse", "--path-format=absolute", "--git-path", "index", root=root).decode().strip())),
        "files": {p: digest(root / p) for p in sorted(set(entries)) if p and (root / p).is_file()},
    }


class Blobs:
    def __init__(self):
        self.process = subprocess.Popen(
            ["git", "cat-file", "--batch"], cwd=SOURCE,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        )
        self.cache: dict[str, bytes] = {}

    def get(self, ref: str, path: str) -> bytes:
        key = f"{ref}:{path}"
        if key not in self.cache:
            self.process.stdin.write((key + "\n").encode())
            self.process.stdin.flush()
            header = self.process.stdout.readline().decode().strip()
            if header.endswith(" missing"):
                raise FileNotFoundError(key)
            size = int(header.split()[-1])
            self.cache[key] = self.process.stdout.read(size)
            assert self.process.stdout.read(1) == b"\n"
        return self.cache[key]

    def close(self):
        self.process.stdin.close()
        self.process.wait()


def manifests(ref: str | None, blobs: Blobs) -> dict[str, dict]:
    names = (
        paths("ls-tree", "-r", "--name-only", ref, "packages") if ref
        else {p.relative_to(SOURCE).as_posix() for p in (SOURCE / "packages").glob("*/package.json")}
    )
    result = {}
    for path in sorted(names):
        if len(path.split("/")) == 3 and path.endswith("/package.json"):
            data = json.loads(blobs.get(ref, path) if ref else (SOURCE / path).read_bytes())
            result[data["name"]] = {"path": path, **data}
    return result


def closure(packages: dict, seeds: list[str]) -> list[str]:
    found: set[str] = set()
    queue = list(seeds)
    while queue:
        name = queue.pop()
        if name in found or name not in packages:
            continue
        found.add(name)
        for section in ("dependencies", "optionalDependencies", "peerDependencies"):
            queue.extend(n for n in packages[name].get(section, {}) if n in packages)
    return sorted(found)


def dry_merge(path: str, original: bytes, incoming: bytes) -> dict:
    current = (SOURCE / path).read_bytes()
    normalized = [b.replace(b"\r\n", b"\n") for b in (current, original, incoming)]
    if normalized[0] == normalized[2]:
        return {"path": path, "status": "already-matches"}
    if normalized[0] == normalized[1]:
        return {"path": path, "status": "upstream-only"}
    if normalized[1] == normalized[2]:
        return {"path": path, "status": "local-only"}
    if any(b"\0" in b for b in normalized):
        return {"path": path, "status": "binary-review"}
    with tempfile.TemporaryDirectory(prefix="ifclite-upstream-study-") as folder:
        files = [Path(folder) / name for name in ("current", "base", "incoming")]
        for file, content in zip(files, normalized):
            file.write_bytes(content)
        run = subprocess.run(["git", "merge-file", "-p", "--diff3", *map(str, files)], capture_output=True)
    return {
        "path": path,
        "status": "clean-text-merge" if run.returncode == 0 else "text-conflict" if 0 < run.returncode < 128 else "merge-error",
        "regions": run.stdout.count(b"<<<<<<< "),
    }


before = {str(root): snapshot(root) for root in (ROOT, SOURCE)}
print("Captured application/index fingerprints for both existing checkouts.", flush=True)
blobs = Blobs()
try:
    local = manifests(None, blobs)
    report = {
        "checked_utc": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE), "base": BASE, "ui_base": UI_BASE,
        "local": {"head": before[str(SOURCE)]["head"], "branch": before[str(SOURCE)]["branch"]},
        "targets": {},
        "limits": [
            "Package presence/version is not proof that a feature is connected to the desktop UI.",
            "Text merge results are risk estimates, not build, test, geometry, or performance evidence.",
            "Core/package base is production 61d209; custom viewer base remains v10.3.0 because the UI was deliberately retained.",
            "Tracked and nonignored untracked application files and indexes are fingerprinted; ignored build caches are outside that set.",
        ],
    }
    core_tree = paths("ls-tree", "-r", "--name-only", BASE)
    ui_tree = paths("ls-tree", "-r", "--name-only", UI_BASE)
    core_local = paths("diff", "--name-only", BASE)
    ui_local = paths("diff", "--name-only", UI_BASE, "--", "apps/viewer")
    local_paths = {p for p in core_local if not p.startswith("apps/viewer/")} | ui_local
    untracked = paths("ls-files", "--others", "--exclude-standard")
    for label, ref in TARGETS.items():
        incoming = manifests(ref, blobs)
        target_tree = paths("ls-tree", "-r", "--name-only", ref)
        changes = paths("diff", "--name-only", BASE, ref)
        ui_changes = paths("diff", "--name-only", UI_BASE, ref, "--", "apps/viewer")
        merge_candidates = sorted(local_paths & ({p for p in changes if not p.startswith("apps/viewer/")} | ui_changes))
        merges = []
        for index, path in enumerate(merge_candidates):
            base_ref, base_tree = (UI_BASE, ui_tree) if path.startswith("apps/viewer/") else (BASE, core_tree)
            if path not in base_tree or path not in target_tree or not (SOURCE / path).is_file():
                merges.append({"path": path, "status": "add-delete-review"})
            else:
                merges.append(dry_merge(path, blobs.get(base_ref, path), blobs.get(ref, path)))
            if index % 100 == 0:
                print(f"{label}: text comparison {index + 1}/{len(merge_candidates)}", flush=True)
        package_rows = []
        for name in sorted(set(local) | set(incoming)):
            old, new = local.get(name), incoming.get(name)
            package_rows.append({
                "name": name, "local": old.get("version") if old else None,
                "upstream": new.get("version") if new else None,
                "private": new.get("private", False) if new else None,
                "description": new.get("description") if new else None,
                "status": "new" if not old else "removed" if not new else "version-changed" if old["version"] != new["version"] else "same-version",
                "source_changed_vs_base": any(p.startswith(new["path"].rsplit("/", 1)[0] + "/") for p in changes) if new else None,
            })
        cargo = tomllib.loads(blobs.get(ref, "Cargo.toml").decode())
        viewer = json.loads(blobs.get(ref, "apps/viewer/package.json"))
        report["targets"][label] = {
            "sha": ref, "commit": git("show", "-s", "--format=%H %cI %s", ref).decode().strip(),
            "rust_version": cargo["workspace"]["package"]["version"],
            "rust_members": cargo["workspace"]["members"], "viewer_version": viewer["version"],
            "package_count": len(incoming), "packages": package_rows,
            "package_summary": dict(Counter(p["status"] for p in package_rows)),
            "core_runtime_closure": closure(incoming, ["@ifc-lite/" + n for n in ("parser", "geometry", "renderer", "data", "spatial", "export", "wasm")]),
            "viewer_runtime_closure": closure(incoming, list(viewer.get("dependencies", {}))),
            "changed_paths_vs_integrated_upstream": len(changes),
            "changes_by_area": dict(sorted(Counter("/".join(p.split("/")[:2]) if p.split("/")[0] in ("apps", "packages", "rust") else p.split("/")[0] for p in changes).items())),
            "untracked_collisions": sorted(untracked & target_tree),
            "merge_summary": dict(Counter(m["status"] for m in merges)), "dry_merges": merges,
        }
        print(f"{label}: {len(incoming)} packages; {report['targets'][label]['merge_summary']}", flush=True)
    release = ROOT / "desktop/release/10.4.0-nhip-load-20261027-r7"
    report["preserved_release"] = {
        p.name: {"path": str(p), "bytes": p.stat().st_size, "sha256": digest(p)}
        for p in (release / "IFC-Lite.exe", release / "source.patch", release / "qualification.json")
    }
    after = {str(root): snapshot(root) for root in (ROOT, SOURCE)}
    preservation = {"before": before, "after": after, "all_unchanged": before == after}
    (OUT / "preservation.json").write_text(json.dumps(preservation, indent=2) + "\n", encoding="utf-8")
    report["application_sources_and_indexes_unchanged"] = before == after
    (OUT / "evidence.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    lines = ["| Package | Desktop 10.4/r7 | Production | Main |", "| --- | --- | --- | --- |"]
    main_rows = {p["name"]: p for p in report["targets"]["main"]["packages"]}
    for row in report["targets"]["production"]["packages"]:
        lines.append(f"| `{row['name']}` | {row['local'] or '—'} | {row['upstream'] or '—'} | {main_rows.get(row['name'], {}).get('upstream') or '—'} |")
    (OUT / "PACKAGES.md").write_text("# Package inventory, 2026-11-05\n\nGenerated from pinned source trees by `audit.py`. Presence does not imply desktop UI integration.\n\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"sources_unchanged": before == after, "release": report["preserved_release"]["IFC-Lite.exe"], "targets": {n: {k: v[k] for k in ("sha", "rust_version", "viewer_version", "package_count", "package_summary", "merge_summary")} for n, v in report["targets"].items()}}, indent=2), flush=True)
finally:
    blobs.close()
