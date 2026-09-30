"""Generation-scoped semantic progress; timestamps advance only on real work."""
from threading import Lock
from time import monotonic
from uuid import uuid4

STALL_SECONDS = 120.0
NATIVE_STALL_SECONDS = 600.0


class IndexProgress:
    def __init__(self):
        self._lock = Lock()
        self._value = None

    def begin(self, model_hash):
        with self._lock:
            self._value = dict(modelHash=model_hash, attemptId=uuid4().hex,
                phase="queued", completed=0, total=None, category=None,
                status="running", updated=monotonic(), error=None)
            return self._value["attemptId"]

    def update(self, attempt, event):
        with self._lock:
            value = self._value
            if value is None or value["attemptId"] != attempt:
                return
            incoming = {k: event[k] for k in ("phase", "completed", "total", "category", "status", "error") if k in event}
            if any(value.get(k) != v for k, v in incoming.items()):
                value.update(incoming)
                value["updated"] = monotonic()

    def snapshot(self, model_hash):
        with self._lock:
            if self._value is None or self._value["modelHash"] != model_hash:
                return None
            value = dict(self._value)
        age = max(0.0, monotonic() - value.pop("updated"))
        limit = NATIVE_STALL_SECONDS if value["phase"] in ("opening", "store") else STALL_SECONDS
        value["idleSeconds"] = round(age, 1)
        value["stallAfterSeconds"] = limit
        value["stalled"] = value["status"] == "running" and age >= limit
        return value
