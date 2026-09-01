"""Application service for IDEA member scans and their latest result."""

from __future__ import annotations

from threading import Lock
from typing import Sequence

import idea_export
from model_runtime import open_model_session


class MemberScanService:
    def __init__(self) -> None:
        self._lock = Lock()
        self._scan: idea_export.Scan | None = None

    def run(
        self,
        global_ids: Sequence[str],
        joint: Sequence[float],
        length_unit: str,
    ) -> dict:
        with open_model_session() as session:
            result = idea_export.scan(session, global_ids, joint, length_unit)
        with self._lock:
            self._scan = result
        return idea_export.scan_wire(result)

    def current(self) -> dict:
        with self._lock:
            result = self._scan
        if result is None:
            return {"schemaVersion": idea_export.IDEA_SCHEMA_VERSION, "hasScan": False}
        return {"hasScan": True, **idea_export.scan_wire(result)}

    def tsv(self) -> str:
        with self._lock:
            result = self._scan
        if result is None:
            return "\t".join(idea_export.GETCOMLIST_HEADER)
        return idea_export.scan_tsv(result)

    def clear(self) -> dict:
        with self._lock:
            self._scan = None
        return {"ok": True, "hasScan": False}
