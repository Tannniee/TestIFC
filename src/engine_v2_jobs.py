"""Single-worker build queue for Engine V2 geometry artifacts."""

from __future__ import annotations

import json
import multiprocessing
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from time import time
from typing import Callable

import model_cache
from engine_v2_artifacts import EngineV2ArtifactRepository, artifact_key_for
from engine_v2_csg import write_csg_overrides
from model_limits import ONE_GIB_BYTES, require_supported_ifc_size


Runner = Callable[[Path, Path, threading.Event], None]


def _convert_overrides_child(source: Path, destination: Path, extra_ids: tuple[int, ...],
                             include_boolean: bool, result_pipe) -> None:
    try:
        converted = write_csg_overrides(source, destination, extra_ids=set(extra_ids),
                                        include_boolean=include_boolean)
        result_pipe.send((True, converted))
    except BaseException as exc:
        result_pipe.send((False, f"{type(exc).__name__}: {exc}"))
    finally:
        result_pipe.close()


@dataclass(slots=True)
class _Job:
    job_id: str
    model_hash: str
    artifact_key: str
    state: str = "queued"
    phase: str = "queued"
    error: str | None = None
    cancel: threading.Event | None = None
    updated_at: float = 0

    def response(self) -> dict:
        return {
            "jobId": self.job_id,
            "modelHash": self.model_hash,
            "artifactKey": self.artifact_key,
            "state": self.state,
            "phase": self.phase,
            "ready": self.state == "ready",
            "error": self.error,
        }


class EngineV2JobManager:
    """Coalesce equal requests and run at most one native conversion at a time."""

    def __init__(self, repository: EngineV2ArtifactRepository, runner: Runner | None = None) -> None:
        self.repository = repository
        self._runner = runner or self._run_worker
        self._condition = threading.Condition()
        self._jobs: dict[str, _Job] = {}
        self._by_artifact: dict[str, str] = {}
        self._pending: deque[str] = deque()
        self._thread: threading.Thread | None = None
        self._closed = False

    def prepare(self, model_hash: str) -> dict:
        source = model_cache.cached_model_file(model_hash)
        require_supported_ifc_size(source.stat().st_size)
        artifact_key = artifact_key_for(model_hash)
        with self._condition:
            if self._closed:
                raise RuntimeError("engine_v2_job_manager_is_shut_down")
            existing_id = self._by_artifact.get(artifact_key)
            if existing_id is not None:
                existing = self._jobs[existing_id]
                if existing.state in {"queued", "running", "ready"}:
                    if existing.state != "ready" or self.repository.is_ready(artifact_key):
                        return existing.response()
            job = _Job(uuid.uuid4().hex, model_hash, artifact_key, updated_at=time())
            if self.repository.is_ready(artifact_key):
                job.state = "ready"
                job.phase = "complete"
            elif verdict := self.repository.fallback_verdict(artifact_key):
                job.state = "error"
                job.phase = "cached-fallback"
                job.error = f"engine_v2_fallback_required: {verdict['reason']}"
            else:
                self._pending.append(job.job_id)
            self._jobs[job.job_id] = job
            self._by_artifact[artifact_key] = job.job_id
            if job.state == "queued" and self._thread is None:
                self._thread = threading.Thread(target=self._drain, name="engine-v2-worker", daemon=True)
                self._thread.start()
            self._condition.notify_all()
            return job.response()

    def status(self, job_id: str) -> dict:
        with self._condition:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            return job.response()

    def cancel(self, job_id: str) -> dict:
        with self._condition:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if job.state == "queued":
                job.state = "cancelled"
                job.phase = "cancelled"
                job.updated_at = time()
                try:
                    self._pending.remove(job_id)
                except ValueError:
                    pass
            elif job.state == "running" and job.cancel is not None:
                job.phase = "cancelling"
                job.cancel.set()
            self._condition.notify_all()
            return job.response()

    def reopen(self) -> None:
        with self._condition:
            if self._thread is not None:
                raise RuntimeError("engine-v2 worker is still running")
            self._closed = False

    def shutdown(self, timeout: float = 5.0) -> bool:
        with self._condition:
            self._closed = True
            for job_id in tuple(self._pending):
                job = self._jobs[job_id]
                job.state = "cancelled"
                job.phase = "cancelled"
            self._pending.clear()
            for job in self._jobs.values():
                if job.state == "running" and job.cancel is not None:
                    job.phase = "cancelling"
                    job.cancel.set()
            thread = self._thread
            self._condition.notify_all()
        if thread is not None:
            thread.join(timeout)
        with self._condition:
            return self._thread is None

    def _drain(self) -> None:
        while True:
            with self._condition:
                if not self._pending:
                    self._thread = None
                    self._condition.notify_all()
                    return
                job = self._jobs[self._pending.popleft()]
                if job.state != "queued":
                    continue
                job.state = "running"
                job.phase = "conversion"
                job.cancel = threading.Event()
                job.updated_at = time()
            self._execute(job)

    def _execute(self, job: _Job) -> None:
        build_root = model_cache.CACHE_DIR / f"{job.artifact_key}.{job.job_id}.partial"
        chunks = build_root / "chunks"
        model_cache.pin_model(job.model_hash)
        try:
            build_root.mkdir(parents=True, exist_ok=False)
            source = model_cache.cached_model_file(job.model_hash)
            self._runner(source, build_root, job.cancel or threading.Event())
            if job.cancel is not None and job.cancel.is_set():
                raise InterruptedError("cancelled")
            with self._condition:
                job.phase = "validation"
            self.repository.promote(chunks, job.artifact_key, job.cancel)
            with self._condition:
                job.state = "ready"
                job.phase = "complete"
                job.updated_at = time()
        except InterruptedError:
            with self._condition:
                job.state = "cancelled"
                job.phase = "cancelled"
                job.updated_at = time()
        except Exception as exc:
            message = str(exc)
            prefix = "engine_v2_fallback_required:"
            if isinstance(exc, RuntimeError) and message.startswith(prefix):
                try:
                    self.repository.record_fallback(job.artifact_key, message[len(prefix):])
                except OSError:
                    pass
            with self._condition:
                job.state = "error"
                job.phase = "failed"
                job.error = message[:1000] or type(exc).__name__
                job.updated_at = time()
        finally:
            shutil.rmtree(build_root, ignore_errors=True)
            model_cache.unpin_model(job.model_hash)
            with self._condition:
                job.cancel = None
                self._condition.notify_all()

    @staticmethod
    def _worker_command() -> list[str]:
        configured = os.environ.get("IFC_ENGINE_V2_WORKER")
        if configured:
            worker = Path(configured).expanduser().resolve()
        elif getattr(sys, "_MEIPASS", None):
            worker = Path(sys._MEIPASS) / "engine_v2" / "worker" / "ifc-engine-v2-scanner.exe"
        else:
            root = Path(__file__).resolve().parents[1]
            worker = root / "engine_v2" / "IfcEngineV2.Scanner" / "bin" / "Release" / "net10.0" / "ifc-engine-v2-scanner.dll"
        if not worker.is_file():
            raise FileNotFoundError("engine_v2_worker_not_found")
        return ["dotnet", str(worker)] if worker.suffix.lower() == ".dll" else [str(worker)]

    @classmethod
    def _run_worker(cls, source: Path, build_root: Path, cancelled: threading.Event) -> None:
        large = source.stat().st_size > ONE_GIB_BYTES
        if large:
            command = cls._worker_command() + [
                "probe", str(source),
                "--output", str(build_root / "probe.json"),
                "--index", str(build_root / "model.ifc2idx"),
                "--check-graph", "--chunks", str(build_root / "chunks"),
            ]
        else:
            command = cls._worker_command() + [
                "scan", str(source),
                "--manifest", str(build_root / "scan-manifest.json"),
                "--index", str(build_root / "model.ifc2idx"),
                "--chunks", str(build_root / "chunks"),
            ]
        failure_ids: set[int] = set()
        try:
            cls._invoke_worker(command, cancelled)
        except RuntimeError as exc:
            if large or not (failure_ids := cls._failure_base_ids(str(exc))):
                raise
        if not large:
            manifest_path = build_root / "scan-manifest.json"
            recovered_ids: set[int] = set()
            include_boolean = False
            for _ in range(8):
                needs_boolean, face_ids = (False, failure_ids) if failure_ids else cls._recovery_targets(manifest_path)
                new_ids = face_ids - recovered_ids
                if not needs_boolean and not new_ids:
                    break
                if needs_boolean and include_boolean and not new_ids:
                    break
                recovered_ids.update(new_ids)
                include_boolean |= needs_boolean
                overrides = build_root / "geometry-overrides.ifcovr"
                converted = cls._convert_overrides_isolated(source, overrides, cancelled,
                                                            recovered_ids, include_boolean)
                if converted == 0:
                    break
                failure_ids = set()
                try:
                    cls._invoke_worker(command + ["--csg-overrides", str(overrides)], cancelled)
                except RuntimeError as exc:
                    if not (failure_ids := cls._failure_base_ids(str(exc))):
                        raise
        cls._require_worker_artifact(build_root, probe=large)

    @staticmethod
    def _convert_overrides_isolated(source: Path, destination: Path, cancelled: threading.Event,
                                    extra_ids: set[int], include_boolean: bool) -> int:
        # IfcOpenShell expands large IFC graphs in memory. End its process after
        # conversion so a loaded model does not retain the converter's heap.
        context = multiprocessing.get_context("spawn")
        receiver, sender = context.Pipe(duplex=False)
        child = context.Process(target=_convert_overrides_child,
                                args=(source, destination, tuple(sorted(extra_ids)), include_boolean, sender))
        try:
            child.start()
            sender.close()
            while child.is_alive():
                child.join(0.1)
                if cancelled.is_set():
                    child.terminate()
                    child.join()
                    raise InterruptedError("cancelled")
            if not receiver.poll():
                raise RuntimeError(f"engine_v2_override_worker_failed: exit code {child.exitcode}")
            success, value = receiver.recv()
            if not success:
                raise RuntimeError(f"engine_v2_override_worker_failed: {value}")
            return int(value)
        finally:
            receiver.close()
            sender.close()
            if child.pid is not None and child.is_alive():
                child.terminate()
                child.join()

    @staticmethod
    def _needs_csg_override(manifest_path: Path) -> bool:
        return EngineV2JobManager._recovery_targets(manifest_path)[0]

    @staticmethod
    def _failure_base_ids(message: str) -> set[int]:
        if not message.startswith("engine_v2_worker_failed:"):
            return set()
        return {int(match.group(1)) for match in re.finditer(
            r"(?:base definition|Direct face set) #(\d+)", message, re.I)}

    @staticmethod
    def _recovery_targets(manifest_path: Path) -> tuple[bool, set[int]]:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if (manifest.get("tessellation") or {}).get("viewerReady"):
                return False, set()
            issues = manifest["coverage"]["graph"]["geometryPlan"]["issues"]
        except (OSError, ValueError, KeyError, TypeError):
            return False, set()
        boolean = any("Nested boolean operand" in issue or "solid second operand" in issue
                      for issue in issues)
        geometry_ids = {int(match.group(1)) for issue in issues
                        for match in re.finditer(r"(?:base definition|Direct face set|Extrusion) #(\d+)", issue, re.I)}
        return boolean, geometry_ids

    @staticmethod
    def _invoke_worker(command: list[str], cancelled: threading.Event) -> None:
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            creationflags=creation_flags,
        )
        while True:
            try:
                stdout, stderr = process.communicate(timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                if not cancelled.is_set():
                    continue
                process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                raise InterruptedError("cancelled")
        if process.returncode != 0:
            detail = (stderr or stdout or f"exit code {process.returncode}").strip()
            raise RuntimeError(f"engine_v2_worker_failed: {detail[:100_000]}")

    @staticmethod
    def _require_worker_artifact(build_root: Path, *, probe: bool = False) -> None:
        scan_manifest = build_root / ("probe.json" if probe else "scan-manifest.json")
        try:
            scan = json.loads(scan_manifest.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, ValueError) as exc:
            raise RuntimeError("engine_v2_worker_manifest_invalid") from exc
        tessellation = scan.get("Tessellation" if probe else "tessellation")
        if tessellation is None or not tessellation.get("ViewerReady" if probe else "viewerReady", False):
            if probe:
                graph = scan.get("GraphValidation") or {}
                reasons = [*(graph.get("Issues") or []), *((graph.get("GeometryPlan") or {}).get("Issues") or [])]
                if tessellation:
                    reasons.extend((tessellation.get("Materials") or {}).get("Issues") or [])
            else:
                reasons = scan.get("coverage", {}).get("reasons", [])
                reasons = [*reasons, *tessellation.get("materials", {}).get("issues", [])] if tessellation else reasons
            detail = "; ".join(str(reason) for reason in reasons[:8]) or "native geometry coverage is incomplete"
            raise RuntimeError(f"engine_v2_fallback_required: {detail}")
