"""Snapshot the custom checkout and integrate pinned upstream layers in isolation."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2]
BASE = "e79f27342beb01a6f30d9b63c44795ecd118f4de"
UPSTREAM = "61d209288c1b117d405628ead302d0ee700bd2a0"
HEAD = "471284f476d64a659ae607eeec2115ca3afcb9fe"


def git(root: Path, *args: str, check: bool = True) -> bytes:
    result = subprocess.run(
        ["git", "-c", "core.autocrlf=false", *args], cwd=root,
        capture_output=True, check=check,
    )
    return result.stdout


def names(root: Path, *args: str) -> set[str]:
    return set(git(root, *args).decode().splitlines())


def sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def output(root: Path, name: str, obj: object) -> None:
    path = root / "research/core-upgrade-20261017" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def snapshot(dest: Path) -> None:
    if git(dest, "rev-parse", "HEAD").decode().strip() != HEAD:
        raise RuntimeError("The isolated checkout must start at the recorded local HEAD")
    if git(dest, "status", "--porcelain").strip():
        raise RuntimeError("Refusing to snapshot over a nonempty isolated worktree")
    changed = names(SOURCE, "diff", "--name-only", "HEAD")
    changed |= names(SOURCE, "ls-files", "--others", "--exclude-standard")
    fingerprints = {}
    for relative in sorted(changed):
        source, target = SOURCE / relative, dest / relative
        if not source.is_file():
            if target.is_file():
                target.unlink()
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        fingerprints[relative] = sha(source)
        if sha(target) != fingerprints[relative]:
            raise RuntimeError(f"Snapshot mismatch: {relative}")
    for fixture in (
        "AC20-FZK-Haus.ifc",
        "ISSUE_129_N1540_17_EXE_MOD_448200_02_09_11SMC_IGC_V17.ifc",
    ):
        relative = "tests/models/ara3d/" + fixture
        if (SOURCE / relative).is_file():
            (dest / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(SOURCE / relative, dest / relative)
    output(dest, "source-snapshot.json", {
        "source": str(SOURCE), "source_head": HEAD, "base": BASE,
        "upstream": UPSTREAM, "files": fingerprints,
        "note": "All nonignored dirty files copied; research artifacts are retained but excluded from the source commit.",
    })
    git(dest, "add", "--all", "--", ".", ":!research")
    git(dest, "-c", "user.name=Codex", "-c", "user.email=codex@openai.com",
        "commit", "-m", "chore: snapshot customized desktop before core upgrade")
    print(json.dumps({"snapshot_files": len(fingerprints),
                      "commit": git(dest, "rev-parse", "HEAD").decode().strip()}))


def integrate(dest: Path, layer: str) -> None:
    core = {"Cargo.toml", "Cargo.lock", "rust-major-offset.json", "rust-toolchain.toml",
            ".cargo/config.toml"}
    closure = json.loads((SOURCE / "research/core-upgrade-20261017/dependency-closure.json").read_text())
    packages = {"packages/" + name.split("/")[1] for name in closure["runtime_workspace_closure"]}

    def wanted(path: str) -> bool:
        if layer == "rust":
            return path in core or path.startswith(("rust/", "apps/server/"))
        if layer == "packages":
            return any(path.startswith(package + "/") for package in packages)
        raise ValueError(layer)

    base_tree = names(SOURCE, "ls-tree", "-r", "--name-only", BASE)
    upstream_tree = names(SOURCE, "ls-tree", "-r", "--name-only", UPSTREAM)
    changed = names(SOURCE, "diff", "--name-only", BASE, UPSTREAM)
    results = []
    for relative in sorted(filter(wanted, changed)):
        target = dest / relative
        original = git(SOURCE, "show", f"{BASE}:{relative}") if relative in base_tree else None
        incoming = git(SOURCE, "show", f"{UPSTREAM}:{relative}") if relative in upstream_tree else None
        current = target.read_bytes() if target.is_file() else None
        if incoming is None:
            if current is not None and current.replace(b"\r\n", b"\n") != original:
                results.append({"path": relative, "status": "delete-vs-local-change"})
                continue
            if target.is_file():
                target.unlink()
            results.append({"path": relative, "status": "removed-upstream"})
            continue
        status, content = "upstream", incoming
        if current is not None and original is not None and current.replace(b"\r\n", b"\n") != original:
            if b"\0" in current + original + incoming:
                raise RuntimeError(f"Binary merge requires review: {relative}")
            with tempfile.TemporaryDirectory(prefix="ifclite-layer-") as temporary:
                files = [Path(temporary) / n for n in ("local", "base", "upstream")]
                for file, data in zip(files, (current, original, incoming)):
                    file.write_bytes(data.replace(b"\r\n", b"\n"))
                result = subprocess.run(
                    ["git", "merge-file", "-p", "--diff3", "-L", "custom-desktop",
                     "-L", "upstream-10.3.0", "-L", "upstream-10.4.0", *map(str, files)],
                    capture_output=True,
                )
            if result.returncode < 0 or result.returncode > 127:
                raise RuntimeError(result.stderr.decode())
            content = result.stdout
            status = "conflict" if result.returncode else "merged-local-and-upstream"
        elif current is not None and original is None and current != incoming:
            raise RuntimeError(f"New upstream path collides with local file: {relative}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        results.append({"path": relative, "status": status})
    output(dest, f"layer-{layer}-integration.json", results)
    print(json.dumps({"layer": layer, "files": len(results),
                      "conflicts": [item["path"] for item in results if "conflict" in item["status"]]}))


parser = argparse.ArgumentParser()
parser.add_argument("action", choices=("snapshot", "rust", "packages"))
parser.add_argument("destination", type=Path)
args = parser.parse_args()
dest = args.destination.resolve()
if dest == SOURCE.resolve() or not (dest / ".git").exists():
    raise RuntimeError("Use a separate existing Git worktree")
if dest != Path("F:/Steel/VBA/IFC-Lite-Core104").resolve():
    raise RuntimeError("Destination must be the isolated core-upgrade worktree")
if args.action == "snapshot":
    snapshot(dest)
else:
    integrate(dest, args.action)
