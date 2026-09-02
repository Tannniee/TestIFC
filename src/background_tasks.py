"""Run at most one task, retaining only the newest pending request."""

from __future__ import annotations

import logging
from threading import Condition, Event, Thread
from typing import Callable


class LatestTaskRunner:
    def __init__(self, name: str) -> None:
        self._name = name
        self._condition = Condition()
        self._pending: tuple[str, Callable[[Event], None]] | None = None
        self._running: tuple[str, Event] | None = None
        self._thread: Thread | None = None

    def submit(self, key: str, work: Callable[[Event], None]) -> None:
        with self._condition:
            if self._running and self._running[0] == key and not self._running[1].is_set():
                self._pending = None
                return
            if self._running:
                self._running[1].set()
            self._pending = (key, work)
            if self._thread is None:
                self._thread = Thread(target=self._drain, name=self._name, daemon=True)
                self._thread.start()

    def cancel(self) -> None:
        with self._condition:
            self._pending = None
            if self._running:
                self._running[1].set()

    def contains(self, key: str) -> bool:
        with self._condition:
            return bool(
                (self._pending and self._pending[0] == key)
                or (self._running and self._running[0] == key and not self._running[1].is_set())
            )

    def wait_idle(self, timeout: float) -> bool:
        with self._condition:
            return self._condition.wait_for(lambda: self._thread is None, timeout)

    def _drain(self) -> None:
        while True:
            with self._condition:
                if self._pending is None:
                    self._running = None
                    self._thread = None
                    self._condition.notify_all()
                    return
                key, work = self._pending
                self._pending = None
                cancelled = Event()
                self._running = (key, cancelled)
            try:
                work(cancelled)
            except Exception:
                logging.getLogger("ifc_viewer.backend.background").exception(
                    "Background task failed", extra={"event": "background_task_failed", "operation": self._name}
                )
            finally:
                with self._condition:
                    self._running = None
