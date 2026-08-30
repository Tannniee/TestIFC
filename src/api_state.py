"""Thread-safe runtime state for the local IFC Viewer bridge."""

from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock, Thread
from typing import Any

import idea_export
from api_contracts import SelectionPayload, SelectionResponse
from mass import DensityTable
from takeoff import model_subject_ids, takeoff


def now_utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def make_selection_response(
    selection: SelectionPayload | None, updated_at: str | None
) -> SelectionResponse:
    if selection is None:
        return SelectionResponse(hasSelection=False, updatedAt=updated_at)
    return SelectionResponse(
        hasSelection=True,
        data=selection,
        updatedAt=updated_at,
        globalId=selection.element.globalId,
        expressId=selection.element.expressId,
        ifcType=selection.element.ifcType,
        objectType=selection.element.objectType,
        name=selection.element.name,
        modelName=selection.model.name,
    )


class BridgeState:
    def __init__(self):
        self._lock = Lock()
        self._selection: SelectionPayload | None = None
        self._updated_at: str | None = None

    def set_selection(self, selection: SelectionPayload) -> SelectionResponse:
        with self._lock:
            self._selection = selection
            self._updated_at = now_utc()
            return make_selection_response(self._selection, self._updated_at)

    def get_selection(self) -> SelectionResponse:
        with self._lock:
            return make_selection_response(self._selection, self._updated_at)

    def clear_selection(self) -> SelectionResponse:
        with self._lock:
            self._selection = None
            self._updated_at = now_utc()
            return make_selection_response(None, self._updated_at)

    def has_selection(self) -> bool:
        with self._lock:
            return self._selection is not None


class ScanState:
    def __init__(self):
        self._lock = Lock()
        self._scan: idea_export.Scan | None = None

    def set_scan(self, scan: idea_export.Scan) -> None:
        with self._lock:
            self._scan = scan

    def get_scan(self) -> idea_export.Scan | None:
        with self._lock:
            return self._scan

    def clear_scan(self) -> None:
        with self._lock:
            self._scan = None


class ModelTakeoffJob:
    def __init__(self):
        self._lock = Lock()
        self._status = "idle"
        self._done = 0
        self._total = 0
        self._result: dict[str, Any] | None = None
        self._error = ""

    def start(self, table: DensityTable, tolerance: float) -> bool:
        with self._lock:
            if self._status == "running":
                return False
            self._status, self._done, self._total, self._result, self._error = (
                "running",
                0,
                0,
                None,
                "",
            )
            Thread(
                target=self._run,
                args=(table, tolerance),
                name="model-takeoff",
                daemon=True,
            ).start()
            return True

    def _run(self, table: DensityTable, tolerance: float) -> None:
        try:
            result = takeoff(
                model_subject_ids(), table, tolerance, on_progress=self._advance
            )
        except Exception as exc:
            with self._lock:
                self._status = "failed"
                self._error = f"{type(exc).__name__}: {exc}"
            return
        with self._lock:
            self._status = "done"
            self._result = result

    def _advance(self, done: int, total: int) -> None:
        with self._lock:
            self._done = done
            self._total = total

    def progress(self) -> dict[str, Any]:
        with self._lock:
            return {
                "status": self._status,
                "done": self._done,
                "total": self._total,
                "error": self._error,
            }

    def result(self) -> dict[str, Any] | None:
        with self._lock:
            return self._result
