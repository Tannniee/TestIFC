"""Validate, promote, and lease renderer-neutral Engine V2 artifacts."""

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import struct
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import model_cache


ARTIFACT_FORMAT = "ifc-engine-v2-tessellation"
ARTIFACT_VERSION = 5
ENGINE_VERSION = "0.8.9-p6.2"
ARTIFACT_PROFILE = "m5-p2-e0.8.9-p6.2"
CHUNK_MAGIC = b"IFCV2CHK"
CHUNK_PROTOCOL_VERSION = 1
CHUNK_HEADER_BYTES = 32
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
MAX_FALLBACK_VERDICT_BYTES = 64 * 1024
FALLBACK_VERDICT_FORMAT = "ifc-engine-v2-fallback-verdict"
POSITION_POLICY = "float64-source-adaptive-triangle-cluster-rebase-before-float32-upload"
NORMAL_POLICY = "octahedral-snorm16-per-triangle"
MATERIAL_POLICY = "base-style-then-mapped-item-style-then-first-material-layer-style-then-default"

_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_ARTIFACT_KEY_RE = re.compile(
    rf"^(?P<source>[0-9a-f]{{64}})\.engine-v2-{re.escape(ARTIFACT_PROFILE)}$"
)
_SHA_RE = re.compile(r"^[0-9A-Fa-f]{64}$")

# file -> (kind, bytes per record, manifest count field)
CHUNK_LAYOUTS: dict[str, tuple[int, int, str]] = {
    "positions.ifcv2": (1, 16, "cartesianPoints"),
    "meshes.ifcv2": (2, 56, "baseDefinitions"),
    "indices.ifcv2": (3, 4, "indices"),
    "instances.ifcv2": (4, 112, "instances"),
    "products.ifcv2": (5, 24, "products"),
    "materials.ifcv2": (6, 32, "materialDefinitions"),
    "instance-materials.ifcv2": (7, 4, "instances"),
    "normals.ifcv2": (8, 4, "triangles"),
    "positions-f64.ifcv2": (9, 32, "cartesianPoints"),
    "semantic-records.ifcv2": (10, 48, "semantic.records"),
    "semantic-strings.ifcv2": (11, 1, "semantic.stringBytes"),
    "semantic-deep-index.ifcv2": (12, 24, "semantic.deep.records"),
    "semantic-deep-values.ifcv2": (13, 1, "semantic.deep.valueBytes"),
}


class ArtifactValidationError(ValueError):
    """The artifact is incomplete, corrupt, or incompatible with this reader."""


def artifact_key_for(model_hash: str) -> str:
    if not _HASH_RE.fullmatch(model_hash):
        raise ValueError("invalid_model_hash")
    return f"{model_hash}.engine-v2-{ARTIFACT_PROFILE}"


def source_hash_from_key(artifact_key: str) -> str:
    match = _ARTIFACT_KEY_RE.fullmatch(artifact_key)
    if match is None:
        raise ValueError("invalid_engine_v2_artifact_key")
    return match.group("source")


def _integer(value: Any, label: str, *, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ArtifactValidationError(f"{label} must be a non-negative integer")
    if maximum is not None and value > maximum:
        raise ArtifactValidationError(f"{label} exceeds {maximum}")
    return value


def _finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ArtifactValidationError(f"{label} must be finite")
    return float(value)


def _sha256(path: Path, cancelled: threading.Event | None = None) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(4 * 1024 * 1024):
            if cancelled is not None and cancelled.is_set():
                raise InterruptedError("cancelled")
            digest.update(block)
    return digest.hexdigest()


class EngineV2ArtifactRepository:
    """Own the cache boundary for complete Engine V2 artifact directories."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._validated: dict[str, tuple[tuple[tuple[str, int, int], ...], dict[str, Any]]] = {}
        self._leases: dict[str, int] = {}

    @staticmethod
    def _fingerprint(directory: Path) -> tuple[tuple[str, int, int], ...]:
        paths = [directory / "manifest.json", *(directory / name for name in CHUNK_LAYOUTS)]
        return tuple((path.name, path.stat().st_mtime_ns, path.stat().st_size) for path in paths)

    def artifact_path(self, artifact_key: str) -> Path:
        source_hash_from_key(artifact_key)
        return model_cache.CACHE_DIR / artifact_key

    def fallback_path(self, artifact_key: str) -> Path:
        source_hash_from_key(artifact_key)
        return model_cache.CACHE_DIR / f"{artifact_key}.unsupported.json"

    def fallback_verdict(self, artifact_key: str) -> dict[str, Any] | None:
        source_hash = source_hash_from_key(artifact_key)
        path = self.fallback_path(artifact_key)
        try:
            if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_FALLBACK_VERDICT_BYTES:
                return None
            verdict = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        if not isinstance(verdict, dict) or verdict.get("format") != FALLBACK_VERDICT_FORMAT:
            return None
        exact = {
            "version": 1,
            "engineVersion": ENGINE_VERSION,
            "artifactProfile": ARTIFACT_PROFILE,
            "sourceSha256": source_hash,
            "fallbackRequired": True,
        }
        if any(verdict.get(field) != expected for field, expected in exact.items()):
            return None
        reason = verdict.get("reason")
        if not isinstance(reason, str) or not reason or len(reason) > 1000:
            return None
        return verdict

    def record_fallback(self, artifact_key: str, reason: str) -> dict[str, Any]:
        source_hash = source_hash_from_key(artifact_key)
        normalized = " ".join(str(reason).split())[:1000]
        if not normalized:
            normalized = "native geometry coverage is incomplete"
        verdict = {
            "format": FALLBACK_VERDICT_FORMAT,
            "version": 1,
            "engineVersion": ENGINE_VERSION,
            "artifactProfile": ARTIFACT_PROFILE,
            "sourceSha256": source_hash,
            "fallbackRequired": True,
            "reason": normalized,
            "recordedAtUnixSeconds": time.time(),
        }
        model_cache.ensure_cache_dir()
        target = self.fallback_path(artifact_key)
        temporary = target.with_name(f"{target.name}.{uuid.uuid4().hex}.partial")
        try:
            temporary.write_text(json.dumps(verdict, separators=(",", ":")), encoding="utf-8")
            with self._lock:
                temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return verdict

    def _clear_fallback(self, artifact_key: str) -> None:
        try:
            self.fallback_path(artifact_key).unlink(missing_ok=True)
        except OSError:
            # A valid artifact always wins during lookup. Verdict cleanup is
            # best-effort and must not turn a successful promotion into failure.
            pass

    def is_ready(self, artifact_key: str) -> bool:
        try:
            self.manifest(artifact_key)
            return True
        except (FileNotFoundError, ArtifactValidationError, OSError, ValueError):
            return False

    def manifest(self, artifact_key: str) -> dict[str, Any]:
        source_hash = source_hash_from_key(artifact_key)
        directory = self.artifact_path(artifact_key)
        manifest_path = directory / "manifest.json"
        if not manifest_path.is_file() or manifest_path.is_symlink():
            raise FileNotFoundError("engine_v2_artifact_not_cached")
        try:
            fingerprint = self._fingerprint(directory)
        except FileNotFoundError as exc:
            raise ArtifactValidationError("artifact is missing a required chunk") from exc
        with self._lock:
            cached = self._validated.get(artifact_key)
            if cached is not None and cached[0] == fingerprint:
                return cached[1]
        manifest = self.validate_directory(directory, source_hash)
        with self._lock:
            self._validated[artifact_key] = (self._fingerprint(directory), manifest)
        return manifest

    def validate_directory(
        self,
        directory: Path,
        expected_source_hash: str,
        cancelled: threading.Event | None = None,
    ) -> dict[str, Any]:
        """Fully validate an untrusted build before promotion or first reuse."""
        if not _HASH_RE.fullmatch(expected_source_hash):
            raise ValueError("invalid_model_hash")
        manifest_path = directory / "manifest.json"
        if not manifest_path.is_file() or manifest_path.is_symlink():
            raise ArtifactValidationError("manifest.json is missing or unsafe")
        if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
            raise ArtifactValidationError("manifest.json is too large")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ArtifactValidationError("manifest.json is not valid UTF-8 JSON") from exc
        if not isinstance(manifest, dict):
            raise ArtifactValidationError("manifest root must be an object")
        self._validate_manifest_contract(manifest, expected_source_hash)
        self._validate_chunks(directory, manifest, cancelled)
        # A worker-local absolute path is neither portable nor part of the read contract.
        manifest["directory"] = "."
        return manifest

    def _validate_manifest_contract(self, manifest: dict[str, Any], expected_source_hash: str) -> None:
        exact = {
            "format": ARTIFACT_FORMAT,
            "version": ARTIFACT_VERSION,
            "engineVersion": ENGINE_VERSION,
            "complete": True,
            "viewerReady": True,
            "coordinateSpace": "ifc-local-source-units",
            "positionPolicy": POSITION_POLICY,
            "normalPolicy": NORMAL_POLICY,
        }
        for field, expected in exact.items():
            if manifest.get(field) != expected:
                raise ArtifactValidationError(f"unsupported manifest {field}")
        source_hash = manifest.get("sourceSha256")
        if not isinstance(source_hash, str) or source_hash.lower() != expected_source_hash:
            raise ArtifactValidationError("artifact source hash does not match the model")
        scale = _finite(manifest.get("lengthUnitScaleToMetres"), "lengthUnitScaleToMetres")
        if scale <= 0:
            raise ArtifactValidationError("lengthUnitScaleToMetres must be positive")
        transform = manifest.get("sourceToViewerTransform")
        if not isinstance(transform, list) or len(transform) != 16:
            raise ArtifactValidationError("sourceToViewerTransform must contain 16 values")
        for index, value in enumerate(transform):
            _finite(value, f"sourceToViewerTransform[{index}]")

        for field in ("cartesianPoints", "baseDefinitions", "products", "instances", "triangles", "indices"):
            _integer(manifest.get(field), field, maximum=0xFFFFFFFF)
        if manifest["indices"] % 3 or manifest["indices"] != manifest["triangles"] * 3:
            raise ArtifactValidationError("triangle and index counts are inconsistent")
        non_simple = _integer(manifest.get("nonSimpleFaces"), "nonSimpleFaces", maximum=0xFFFFFFFF)
        recovered = _integer(manifest.get("recoveredDisjointFaces"), "recoveredDisjointFaces", maximum=non_simple)
        details = manifest.get("nonSimpleFaceDetails")
        if not isinstance(details, list) or len(details) != non_simple:
            raise ArtifactValidationError("non-simple face diagnostics are inconsistent")
        recovered_details = 0
        for detail in details:
            if not isinstance(detail, dict):
                raise ArtifactValidationError("non-simple face diagnostic is invalid")
            islands = _integer(detail.get("recoveredIslands"), "recoveredIslands", maximum=0xFFFFFFFF)
            if islands:
                recovered_details += 1
                holes = _integer(detail.get("holes"), "holes", maximum=0xFFFFFFFF)
                triangles = _integer(detail.get("triangles"), "triangles", maximum=0xFFFFFFFF)
                if (islands > holes or triangles == 0 or detail.get("empty") is not False
                        or detail.get("containmentRejected") is not False):
                    raise ArtifactValidationError("recovered face is marked incomplete")
        if recovered_details != recovered:
            raise ArtifactValidationError("recovered face count is inconsistent")

        materials = manifest.get("materials")
        if not isinstance(materials, dict) or materials.get("status") != "complete":
            raise ArtifactValidationError("material coverage is incomplete")
        if materials.get("assignmentPolicy") != MATERIAL_POLICY:
            raise ArtifactValidationError("unsupported material assignment policy")
        definitions = _integer(materials.get("materialDefinitions"), "materials.materialDefinitions", maximum=0xFFFFFFFF)
        assignments = _integer(materials.get("instanceAssignments"), "materials.instanceAssignments", maximum=0xFFFFFFFF)
        if definitions == 0 or assignments != manifest["instances"]:
            raise ArtifactValidationError("material counts are inconsistent")

        type_names = manifest.get("typeNames")
        if (not isinstance(type_names, list) or not type_names or len(type_names) > 0xFFFF
                or any(not isinstance(value, str) or not value for value in type_names)):
            raise ArtifactValidationError("typeNames must contain the source entity registry")
        semantic = manifest.get("semantic")
        if not isinstance(semantic, dict) or semantic.get("status") != "complete":
            raise ArtifactValidationError("native semantic coverage is incomplete")
        records = _integer(semantic.get("records"), "semantic.records", maximum=0xFFFFFFFF)
        parent_links = _integer(semantic.get("parentLinks"), "semantic.parentLinks", maximum=records)
        roots = _integer(semantic.get("roots"), "semantic.roots", maximum=records)
        represented = _integer(semantic.get("representedProducts"), "semantic.representedProducts", maximum=records)
        _integer(semantic.get("stringBytes"), "semantic.stringBytes", maximum=0xFFFFFFFF)
        if records == 0 or parent_links + roots != records or represented != manifest["products"]:
            raise ArtifactValidationError("native semantic-core counts are inconsistent")
        deep = semantic.get("deep")
        if not isinstance(deep, dict) or deep.get("status") != "complete":
            raise ArtifactValidationError("native deep-semantic coverage is incomplete")
        deep_records = _integer(deep.get("records"), "semantic.deep.records", maximum=0xFFFFFFFF)
        related = _integer(deep.get("productsWithRelations"), "semantic.deep.productsWithRelations", maximum=deep_records)
        _integer(deep.get("relationEdges"), "semantic.deep.relationEdges", maximum=0xFFFFFFFF)
        value_bytes = _integer(deep.get("valueBytes"), "semantic.deep.valueBytes", maximum=0xFFFFFFFF)
        maximum_record = _integer(deep.get("maximumRecordBytes"), "semantic.deep.maximumRecordBytes", maximum=8 * 1024 * 1024)
        if deep_records != represented or (deep_records and value_bytes == 0) or maximum_record > value_bytes:
            raise ArtifactValidationError("native deep-semantic counts are inconsistent")

        chunks = manifest.get("chunks")
        if not isinstance(chunks, list) or len(chunks) != len(CHUNK_LAYOUTS):
            raise ArtifactValidationError("manifest has an unexpected chunk count")

    def _validate_chunks(
        self,
        directory: Path,
        manifest: dict[str, Any],
        cancelled: threading.Event | None = None,
    ) -> None:
        by_name: dict[str, dict[str, Any]] = {}
        for item in manifest["chunks"]:
            if not isinstance(item, dict) or not isinstance(item.get("file"), str):
                raise ArtifactValidationError("invalid chunk descriptor")
            filename = item["file"]
            if filename not in CHUNK_LAYOUTS or filename in by_name:
                raise ArtifactValidationError(f"unexpected or duplicate chunk {filename}")
            by_name[filename] = item
        if set(by_name) != set(CHUNK_LAYOUTS):
            raise ArtifactValidationError("required chunks are missing")

        for filename, (expected_kind, stride, count_field) in CHUNK_LAYOUTS.items():
            if cancelled is not None and cancelled.is_set():
                raise InterruptedError("cancelled")
            item = by_name[filename]
            materials = manifest["materials"]
            if count_field == "materialDefinitions":
                expected_records = materials[count_field]
            elif count_field.startswith("semantic."):
                field_path = count_field.split(".")[1:]
                expected_records = manifest["semantic"]
                for field in field_path:
                    expected_records = expected_records[field]
            else:
                expected_records = manifest[count_field]
            kind = _integer(item.get("kind"), f"{filename}.kind", maximum=0xFFFF)
            size = _integer(item.get("sizeBytes"), f"{filename}.sizeBytes")
            payload = _integer(item.get("payloadBytes"), f"{filename}.payloadBytes")
            records = _integer(item.get("recordCount"), f"{filename}.recordCount", maximum=0xFFFFFFFF)
            checksum = item.get("sha256")
            if kind != expected_kind or records != expected_records:
                raise ArtifactValidationError(f"{filename} kind or record count is inconsistent")
            if payload != records * stride or size != CHUNK_HEADER_BYTES + payload:
                raise ArtifactValidationError(f"{filename} length is inconsistent")
            if not isinstance(checksum, str) or not _SHA_RE.fullmatch(checksum):
                raise ArtifactValidationError(f"{filename} checksum is invalid")

            path = directory / filename
            if not path.is_file() or path.is_symlink() or path.stat().st_size != size:
                raise ArtifactValidationError(f"{filename} is missing, unsafe, or truncated")
            with path.open("rb") as stream:
                header = stream.read(CHUNK_HEADER_BYTES)
            if len(header) != CHUNK_HEADER_BYTES:
                raise ArtifactValidationError(f"{filename} header is truncated")
            magic, version, header_kind, header_bytes, header_payload, header_records, flags = struct.unpack(
                "<8sHHIQII", header
            )
            if (
                magic != CHUNK_MAGIC
                or version != CHUNK_PROTOCOL_VERSION
                or header_kind != kind
                or header_bytes != CHUNK_HEADER_BYTES
                or header_payload != payload
                or header_records != records
                or flags != 0
            ):
                raise ArtifactValidationError(f"{filename} header does not match its manifest")
            if _sha256(path, cancelled).lower() != checksum.lower():
                raise ArtifactValidationError(f"{filename} checksum does not match")

    def promote(
        self,
        build_directory: Path,
        artifact_key: str,
        cancelled: threading.Event | None = None,
    ) -> dict[str, Any]:
        source_hash = source_hash_from_key(artifact_key)
        manifest = self.validate_directory(build_directory, source_hash, cancelled)
        if cancelled is not None and cancelled.is_set():
            raise InterruptedError("cancelled")
        target = self.artifact_path(artifact_key)
        model_cache.ensure_cache_dir()
        with self._lock:
            if target.exists():
                try:
                    # Another completed build wins only if it is itself valid.
                    existing = self.manifest(artifact_key)
                except (ArtifactValidationError, FileNotFoundError, OSError):
                    if self._leases.get(artifact_key, 0):
                        raise ArtifactValidationError("invalid artifact is currently leased")
                    self._validated.pop(artifact_key, None)
                    model_cache._remove_cache_path(target)
                    if target.exists():
                        raise OSError("invalid engine v2 artifact could not be replaced")
                else:
                    shutil.rmtree(build_directory, ignore_errors=True)
                    self._clear_fallback(artifact_key)
                    return existing
            build_directory.replace(target)
            self._clear_fallback(artifact_key)
            self._validated[artifact_key] = (self._fingerprint(target), manifest)
        return manifest

    def chunk_path(self, artifact_key: str, filename: str) -> Path:
        manifest = self.manifest(artifact_key)
        registered = {chunk["file"] for chunk in manifest["chunks"]}
        if filename not in registered or filename not in CHUNK_LAYOUTS:
            raise FileNotFoundError("engine_v2_chunk_not_found")
        return self.artifact_path(artifact_key) / filename

    @contextmanager
    def lease(self, artifact_key: str) -> Iterator[None]:
        source_hash = source_hash_from_key(artifact_key)
        with self._lock:
            self._leases[artifact_key] = self._leases.get(artifact_key, 0) + 1
        model_cache.pin_model(source_hash)
        try:
            yield
        finally:
            model_cache.unpin_model(source_hash)
            with self._lock:
                count = self._leases.get(artifact_key, 0)
                if count <= 1:
                    self._leases.pop(artifact_key, None)
                else:
                    self._leases[artifact_key] = count - 1
