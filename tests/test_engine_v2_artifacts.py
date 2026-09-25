from __future__ import annotations

import hashlib
import json
import shutil
import struct
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import model_cache
from engine_v2_artifacts import (
    ARTIFACT_PROFILE,
    ArtifactValidationError,
    CHUNK_LAYOUTS,
    EngineV2ArtifactRepository,
    MATERIAL_POLICY,
    NORMAL_POLICY,
    POSITION_POLICY,
    artifact_key_for,
)
from engine_v2_jobs import EngineV2JobManager
from api_routes.engine_v2 import create_engine_v2_router


COUNTS = {
    "cartesianPoints": 2,
    "baseDefinitions": 1,
    "products": 1,
    "instances": 1,
    "triangles": 1,
    "indices": 3,
}


def write_artifact(directory: Path, source_hash: str) -> dict:
    directory.mkdir(parents=True)
    chunks = []
    for filename, (kind, stride, count_field) in CHUNK_LAYOUTS.items():
        records = ({
                       "semantic.records": 1,
                       "semantic.stringBytes": 4,
                       "semantic.deep.records": 1,
                       "semantic.deep.valueBytes": 2,
                   }.get(count_field)
                   if count_field.startswith("semantic.") else
                   1 if count_field == "materialDefinitions" else COUNTS[count_field])
        payload = bytes([kind]) * (records * stride)
        header = struct.pack("<8sHHIQII", b"IFCV2CHK", 1, kind, 32, len(payload), records, 0)
        body = header + payload
        (directory / filename).write_bytes(body)
        chunks.append({
            "file": filename,
            "kind": kind,
            "sizeBytes": len(body),
            "payloadBytes": len(payload),
            "recordCount": records,
            "sha256": hashlib.sha256(body).hexdigest().upper(),
        })
    manifest = {
        "format": "ifc-engine-v2-tessellation",
        "version": 5,
        "engineVersion": "0.8.9-p6.2",
        "complete": True,
        "viewerReady": True,
        "directory": "C:/must/not/be/trusted",
        "sourceSha256": source_hash.upper(),
        "coordinateSpace": "ifc-local-source-units",
        **COUNTS,
        "nonSimpleFaces": 0,
        "recoveredDisjointFaces": 0,
        "nonSimpleFaceDetails": [],
        "lengthUnitScaleToMetres": 0.001,
        "sourceToViewerTransform": [1.0, 0.0, 0.0, 0.0] * 4,
        "positionPolicy": POSITION_POLICY,
        "normalPolicy": NORMAL_POLICY,
        "materials": {
            "status": "complete",
            "assignmentPolicy": MATERIAL_POLICY,
            "materialDefinitions": 1,
            "instanceAssignments": 1,
        },
        "typeNames": ["IFCWALL"],
        "semantic": {
            "status": "complete",
            "records": 1,
            "parentLinks": 0,
            "roots": 1,
            "representedProducts": 1,
            "stringBytes": 4,
            "deep": {
                "status": "complete",
                "records": 1,
                "productsWithRelations": 0,
                "relationEdges": 0,
                "valueBytes": 2,
                "maximumRecordBytes": 2,
            },
        },
        "chunks": chunks,
    }
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


class EngineV2ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.cache = Path(self.temporary.name)
        self.cache_patch = patch.object(model_cache, "CACHE_DIR", self.cache)
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.hash = hashlib.sha256(b"IFC").hexdigest()
        self.key = artifact_key_for(self.hash)
        self.repository = EngineV2ArtifactRepository()

    def test_complete_artifact_is_validated_and_absolute_worker_directory_is_ignored(self):
        write_artifact(self.cache / self.key, self.hash)
        manifest = self.repository.manifest(self.key)
        self.assertEqual(manifest["sourceSha256"].lower(), self.hash)
        self.assertEqual(manifest["directory"], ".")
        self.assertEqual(self.repository.chunk_path(self.key, "positions.ifcv2").parent, self.cache / self.key)

    def test_recovered_face_diagnostics_are_consistent(self):
        directory = self.cache / self.key
        manifest = write_artifact(directory, self.hash)
        manifest["nonSimpleFaces"] = 1
        manifest["recoveredDisjointFaces"] = 1
        manifest["nonSimpleFaceDetails"] = [{"recoveredIslands": 2, "holes": 2, "triangles": 4, "empty": False,
                                             "containmentRejected": False}]
        (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        self.assertEqual(self.repository.validate_directory(directory, self.hash)["recoveredDisjointFaces"], 1)
        manifest["recoveredDisjointFaces"] = 0
        (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaises(ArtifactValidationError):
            self.repository.validate_directory(directory, self.hash)

    def test_corrupt_chunk_and_source_mismatch_are_rejected(self):
        directory = self.cache / self.key
        write_artifact(directory, self.hash)
        path = directory / "indices.ifcv2"
        path.write_bytes(path.read_bytes()[:-1] + b"X")
        with self.assertRaisesRegex(ArtifactValidationError, "checksum"):
            self.repository.manifest(self.key)
        write_artifact(self.cache / "replacement", "f" * 64)
        with self.assertRaisesRegex(ArtifactValidationError, "source hash"):
            self.repository.validate_directory(self.cache / "replacement", self.hash)

    def test_pre_guard_p62_artifact_cannot_be_reused(self):
        directory = self.cache / self.key
        manifest = write_artifact(directory, self.hash)
        manifest["engineVersion"] = "0.8.0-p6.2"
        (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ArtifactValidationError, "engineVersion"):
            self.repository.manifest(self.key)

    def test_manifest_cannot_register_a_traversal_or_unknown_chunk(self):
        directory = self.cache / self.key
        manifest = write_artifact(directory, self.hash)
        manifest["chunks"][0]["file"] = "../positions.ifcv2"
        (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ArtifactValidationError, "unexpected"):
            self.repository.manifest(self.key)

    def test_download_lease_protects_the_whole_source_bundle(self):
        write_artifact(self.cache / self.key, self.hash)
        other_hash = "b" * 64
        (self.cache / f"{other_hash}.ifc").write_bytes(b"old")
        with self.repository.lease(self.key):
            self.assertIn(self.hash, model_cache.pinned_model_hashes())
            model_cache.clear_cache("all", active_hash=other_hash)
            self.assertTrue((self.cache / self.key).exists())
        self.assertNotIn(self.hash, model_cache.pinned_model_hashes())

    def test_job_build_is_coalesced_promoted_and_reused(self):
        source = self.cache / f"{self.hash}.ifc"
        source.write_bytes(b"IFC")
        calls = []
        completed = threading.Event()

        def runner(source_path: Path, build_root: Path, cancelled: threading.Event):
            calls.append(source_path)
            write_artifact(build_root / "chunks", self.hash)
            completed.set()

        manager = EngineV2JobManager(self.repository, runner)
        first = manager.prepare(self.hash)
        second = manager.prepare(self.hash)
        self.assertEqual(first["jobId"], second["jobId"])
        self.assertTrue(completed.wait(2))
        for _ in range(100):
            status = manager.status(first["jobId"])
            if status["state"] == "ready":
                break
            time.sleep(0.01)
        self.assertEqual(status["state"], "ready")
        self.assertEqual(len(calls), 1)
        self.assertTrue((self.cache / self.key / "manifest.json").exists())
        reused = manager.prepare(self.hash)
        self.assertTrue(reused["ready"])
        self.assertEqual(len(calls), 1)
        # Cache cleanup may remove a completed artifact while the server and
        # its job manager stay alive. A stale ready job must rebuild it.
        shutil.rmtree(self.cache / self.key)
        rebuilt = manager.prepare(self.hash)
        self.assertNotEqual(rebuilt["jobId"], first["jobId"])
        for _ in range(100):
            if manager.status(rebuilt["jobId"])["state"] == "ready":
                break
            time.sleep(0.01)
        self.assertTrue(self.repository.is_ready(self.key))
        self.assertEqual(len(calls), 2)
        self.assertTrue(manager.shutdown(2))

    def test_running_job_can_be_cancelled_without_publishing_partials(self):
        (self.cache / f"{self.hash}.ifc").write_bytes(b"IFC")
        started = threading.Event()

        def runner(_source: Path, build_root: Path, cancelled: threading.Event):
            started.set()
            (build_root / "incomplete").write_bytes(b"partial")
            cancelled.wait(2)
            raise InterruptedError("cancelled")

        manager = EngineV2JobManager(self.repository, runner)
        job = manager.prepare(self.hash)
        self.assertTrue(started.wait(2))
        manager.cancel(job["jobId"])
        for _ in range(100):
            status = manager.status(job["jobId"])
            if status["state"] == "cancelled":
                break
            time.sleep(0.01)
        self.assertEqual(status["state"], "cancelled")
        self.assertFalse((self.cache / self.key).exists())
        self.assertFalse(any(self.cache.glob(f"*.engine-v2-{ARTIFACT_PROFILE}.*.partial")))
        self.assertTrue(manager.shutdown(2))

    def test_valid_build_replaces_a_corrupt_unleased_derived_artifact(self):
        target = self.cache / self.key
        write_artifact(target, self.hash)
        (target / "indices.ifcv2").write_bytes(b"corrupt")
        build = self.cache / "replacement-build"
        write_artifact(build, self.hash)
        promoted = self.repository.promote(build, self.key)
        self.assertEqual(promoted["directory"], ".")
        self.assertTrue(self.repository.is_ready(self.key))

    def test_fallback_verdict_is_profile_scoped_persistent_and_cleared_by_promotion(self):
        (self.cache / f"{self.hash}.ifc").write_bytes(b"IFC")
        calls = []

        def unsupported(_source: Path, _build_root: Path, _cancelled: threading.Event):
            calls.append("worker")
            raise RuntimeError("engine_v2_fallback_required: IfcCompositeCurve #206 is unsupported")

        manager = EngineV2JobManager(self.repository, unsupported)
        first = manager.prepare(self.hash)
        for _ in range(100):
            status = manager.status(first["jobId"])
            if status["state"] == "error":
                break
            time.sleep(0.01)
        self.assertEqual(status["state"], "error")
        self.assertEqual(len(calls), 1)
        self.assertTrue(manager.shutdown(2))

        restarted = EngineV2JobManager(EngineV2ArtifactRepository(), unsupported)
        cached = restarted.prepare(self.hash)
        self.assertEqual(cached["state"], "error")
        self.assertEqual(cached["phase"], "cached-fallback")
        self.assertIn("IfcCompositeCurve", cached["error"])
        self.assertEqual(len(calls), 1)
        self.assertTrue(restarted.shutdown(2))

        build = self.cache / "supported-build"
        write_artifact(build, self.hash)
        self.repository.promote(build, self.key)
        self.assertIsNone(self.repository.fallback_verdict(self.key))

    def test_packaged_worker_is_resolved_without_dotnet(self):
        bundle = self.cache / "bundle"
        worker = bundle / "engine_v2" / "worker" / "ifc-engine-v2-scanner.exe"
        worker.parent.mkdir(parents=True)
        worker.write_bytes(b"worker")
        with patch.object(sys, "_MEIPASS", str(bundle), create=True):
            self.assertEqual(EngineV2JobManager._worker_command(), [str(worker)])

    def test_worker_fallback_manifest_preserves_precise_coverage_reason(self):
        build = self.cache / "fallback-build"
        build.mkdir()
        (build / "scan-manifest.json").write_text(json.dumps({
            "coverage": {"reasons": ["Unsupported geometry entity IFCBOOLEANRESULT: 24."]},
            "tessellation": None,
        }), encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "engine_v2_fallback_required:.*IFCBOOLEANRESULT"):
            EngineV2JobManager._require_worker_artifact(build)

    def test_worker_ready_manifest_passes_artifact_gate(self):
        build = self.cache / "ready-build"
        build.mkdir()
        (build / "scan-manifest.json").write_text(json.dumps({
            "coverage": {"reasons": []},
            "tessellation": {"viewerReady": True},
        }), encoding="utf-8")
        EngineV2JobManager._require_worker_artifact(build)

    def test_large_worker_uses_bounded_probe_artifact_path(self):
        source = self.cache / "large.ifc"
        source.write_bytes(b"X")
        build = self.cache / "large-build"
        process = Mock()
        process.poll.return_value = 0
        process.communicate.return_value = ("", "")
        process.returncode = 0
        with patch("engine_v2_jobs.ONE_GIB_BYTES", 0), \
             patch.object(EngineV2JobManager, "_worker_command", return_value=["worker"]), \
             patch("engine_v2_jobs.subprocess.Popen", return_value=process) as started, \
             patch.object(EngineV2JobManager, "_require_worker_artifact") as checked:
            EngineV2JobManager._run_worker(source, build, threading.Event())
        command = started.call_args.args[0]
        self.assertEqual(command[1:3], ["probe", str(source)])
        self.assertIn("--check-graph", command)
        checked.assert_called_once_with(build, probe=True)

    def test_large_probe_manifest_requires_complete_artifact(self):
        build = self.cache / "large-probe-build"
        build.mkdir()
        path = build / "probe.json"
        path.write_text(json.dumps({
            "GraphValidation": {"Issues": ["Unsupported item #7"]},
            "Tessellation": None,
        }), encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "engine_v2_fallback_required:.*Unsupported item #7"):
            EngineV2JobManager._require_worker_artifact(build, probe=True)
        path.write_text(json.dumps({"Tessellation": {"ViewerReady": True}}), encoding="utf-8")
        EngineV2JobManager._require_worker_artifact(build, probe=True)


class EngineV2RangeResponseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.cache_patch = patch.object(model_cache, "CACHE_DIR", Path(self.temporary.name))
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.hash = hashlib.sha256(b"range").hexdigest()
        self.repository = EngineV2ArtifactRepository()
        self.jobs = EngineV2JobManager(self.repository)
        write_artifact(self.repository.artifact_path(artifact_key_for(self.hash)), self.hash)
        application = FastAPI()
        application.include_router(create_engine_v2_router(self.repository, self.jobs))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application),
            base_url="http://127.0.0.1",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        self.jobs.shutdown(2)

    async def test_chunk_range_keeps_artifact_lease_and_returns_exact_bytes(self):
        key = artifact_key_for(self.hash)
        response = await self.client.get(
            f"/model/engine-v2/artifacts/{key}/chunks/semantic-deep-values.ifcv2",
            headers={"Range": "bytes=32-33"},
        )
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["content-range"], "bytes 32-33/34")
        self.assertEqual(response.content, bytes([13, 13]))
        self.assertNotIn(self.hash, model_cache.pinned_model_hashes())


if __name__ == "__main__":
    unittest.main()
