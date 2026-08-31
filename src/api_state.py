"""Thread-safe runtime state for the local IFC Viewer bridge."""

from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock

from api_contracts import SelectionPayload, SelectionResponse


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
