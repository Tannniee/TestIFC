"""Application services for synchronous and background mass takeoff."""

from __future__ import annotations

from threading import Event, Lock, Thread
from contextlib import AbstractContextManager
from typing import Any, Callable, Sequence

import excel_quickview
from mass import DensityTable
from model_runtime import ModelLease, ModelSession, lease_active_model, open_model_session
from takeoff import (
    QUICKVIEW_KG_COLUMNS,
    UnknownElementError,
    model_subject_ids,
    quickview_rows,
    takeoff,
    takeoff_csv,
)


TakeoffRunner = Callable[..., dict[str, Any]]
SubjectIdReader = Callable[[ModelSession], list[str]]
SessionFactory = Callable[..., AbstractContextManager[ModelSession]]


class QuickviewUnavailableError(RuntimeError):
    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


class TakeoffService:
    """Run takeoff use cases without exposing HTTP request objects."""

    def __init__(
        self,
        subject_id_reader: SubjectIdReader = model_subject_ids,
        runner: TakeoffRunner = takeoff,
        session_factory: SessionFactory = open_model_session,
    ) -> None:
        self._subject_id_reader = subject_id_reader
        self._runner = runner
        self._session_factory = session_factory

    def run(
        self,
        scope: str,
        global_ids: Sequence[str],
        table: DensityTable,
        tolerance: float,
        on_progress: Callable[[int, int], Any] | None = None,
        lease: ModelLease | None = None,
    ) -> dict[str, Any]:
        with self._session_factory(lease=lease) as session:
            subjects = (
                list(global_ids)
                if scope == "selection"
                else self._subject_id_reader(session)
            )
            return self._runner(
                session,
                subjects,
                table,
                tolerance,
                on_progress=on_progress,
            )

    def run_model(
        self,
        table: DensityTable,
        tolerance: float,
        on_progress: Callable[[int, int], Any] | None = None,
        lease: ModelLease | None = None,
    ) -> dict[str, Any]:
        return self.run("model", (), table, tolerance, on_progress, lease)

    @staticmethod
    def csv(result: dict[str, Any]) -> str:
        return takeoff_csv(result)

    @staticmethod
    def quickview(result: dict[str, Any]):
        return quickview_rows(result)

    def open_quickview(self, result: dict[str, Any]) -> dict[str, Any]:
        rows, header_index = self.quickview(result)
        outcome = excel_quickview.open_table(
            rows,
            QUICKVIEW_KG_COLUMNS,
            header_index,
        )
        if isinstance(outcome, excel_quickview.Unavailable):
            raise QuickviewUnavailableError(outcome.reason, outcome.detail)
        return {"status": "opened", "book": outcome.book, "rows": outcome.rows}


class ModelTakeoffJob:
    """Own one background model-takeoff lifecycle."""

    def __init__(self, service: TakeoffService | None = None) -> None:
        self._service = service or TakeoffService()
        self._lock = Lock()
        self._status = "idle"
        self._done = 0
        self._total = 0
        self._result: dict[str, Any] | None = None
        self._error = ""
        self._model_hash = ""
        self._thread: Thread | None = None
        self._cancelled = Event()
        self._closed = False

    def start(self, table: DensityTable, tolerance: float) -> bool:
        with self._lock:
            if self._closed or self._status in ("starting", "running"):
                return False
            self._cancelled.clear()
            self._status = "starting"
            self._done = 0
            self._total = 0
            self._result = None
            self._error = ""
            self._model_hash = ""

        try:
            lease = lease_active_model()
        except BaseException:
            with self._lock:
                self._status = "idle"
            raise

        with self._lock:
            self._status = "running"
            self._model_hash = lease.ref.model_hash
            try:
                if self._closed:
                    lease.release()
                    self._status = "idle"
                    return False
                self._thread = Thread(
                    target=self._run,
                    args=(table, tolerance, lease),
                    name="model-takeoff",
                    daemon=True,
                )
                self._thread.start()
            except BaseException:
                lease.release()
                self._thread = None
                self._status = "idle"
                self._model_hash = ""
                raise
            return True

    def _run(
        self,
        table: DensityTable,
        tolerance: float,
        lease: ModelLease,
    ) -> None:
        try:
            result = self._service.run_model(
                table,
                tolerance,
                on_progress=self._advance,
                lease=lease,
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
        if self._cancelled.is_set():
            raise RuntimeError("Model takeoff cancelled during shutdown")
        with self._lock:
            self._done = done
            self._total = total

    def reopen(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise RuntimeError("Model takeoff has not stopped")
            self._closed = False

    def shutdown(self, timeout: float = 5.0) -> bool:
        with self._lock:
            self._closed = True
            self._cancelled.set()
            thread = self._thread
        if thread is not None:
            thread.join(timeout)
        return thread is None or not thread.is_alive()

    def progress(self) -> dict[str, Any]:
        with self._lock:
            return {
                "status": self._status,
                "done": self._done,
                "total": self._total,
                "error": self._error,
                "modelHash": self._model_hash,
            }

    def result(self) -> dict[str, Any] | None:
        with self._lock:
            return self._result
