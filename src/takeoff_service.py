"""Application services for synchronous and background mass takeoff."""

from __future__ import annotations

from threading import Lock, Thread
from typing import Any, Callable, Sequence

import excel_quickview
from mass import DensityTable
from takeoff import (
    QUICKVIEW_KG_COLUMNS,
    UnknownElementError,
    model_subject_ids,
    quickview_rows,
    takeoff,
    takeoff_csv,
)


TakeoffRunner = Callable[..., dict[str, Any]]
SubjectIdReader = Callable[[], list[str]]


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
    ) -> None:
        self._subject_id_reader = subject_id_reader
        self._runner = runner

    def run(
        self,
        scope: str,
        global_ids: Sequence[str],
        table: DensityTable,
        tolerance: float,
        on_progress: Callable[[int, int], Any] | None = None,
    ) -> dict[str, Any]:
        subjects = list(global_ids) if scope == "selection" else self._subject_id_reader()
        return self._runner(subjects, table, tolerance, on_progress=on_progress)

    def run_model(
        self,
        table: DensityTable,
        tolerance: float,
        on_progress: Callable[[int, int], Any] | None = None,
    ) -> dict[str, Any]:
        return self.run("model", (), table, tolerance, on_progress)

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

    def start(self, table: DensityTable, tolerance: float) -> bool:
        with self._lock:
            if self._status == "running":
                return False
            self._status = "running"
            self._done = 0
            self._total = 0
            self._result = None
            self._error = ""
            Thread(
                target=self._run,
                args=(table, tolerance),
                name="model-takeoff",
                daemon=True,
            ).start()
            return True

    def _run(self, table: DensityTable, tolerance: float) -> None:
        try:
            result = self._service.run_model(
                table,
                tolerance,
                on_progress=self._advance,
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
