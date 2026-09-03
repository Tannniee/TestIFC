"""Exercise cold indexing, concurrent readers, cancellation and resume in a new cache."""
from __future__ import annotations
import json
import multiprocessing
import sqlite3
import sys
from contextlib import closing
from pathlib import Path
from threading import Event, Thread
from time import monotonic

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def main():
    import index_builder
    import model_index
    from content_hash import sha256_file
    source, output = map(Path, sys.argv[1:3])
    output.mkdir(parents=True, exist_ok=True)
    model_hash = sha256_file(source)
    cache = output / "cache"
    target = model_index.index_path_for(cache, model_hash)
    if target.exists():
        raise RuntimeError("Use a new output directory for the cold/resume benchmark")
    stop, cold, cancel = Event(), Event(), Event()
    latencies, failures, events = [], [], []
    attempt = 1
    started = monotonic()

    def progress(event):
        events.append({"attempt": attempt, "seconds": round(monotonic() - started, 3), **event})
        if event.get("phase") == "cold":
            cold.set()
            if attempt == 1 and event.get("completed", 0) >= 512:
                cancel.set()

    def probe():
        while not stop.wait(.05):
            if not cold.is_set():
                continue
            before = monotonic()
            try:
                index = model_index.ModelIndex(target)
                roots = index.roots()
                if roots:
                    index.record_by_express_id(roots[0])
                with closing(sqlite3.connect(target.resolve().as_uri() + "?mode=ro", uri=True, timeout=.75)) as reader:
                    reader.execute("SELECT COUNT(*) FROM element_fts WHERE element_fts MATCH 'steel'").fetchone()
                latencies.append((monotonic() - before) * 1000)
            except Exception as exc:
                failures.append(str(exc))
    thread = Thread(target=probe)
    thread.start()
    try:
        try:
            index_builder.prepare_model(str(source), model_hash, str(cache), cancelled=cancel.is_set, on_progress=progress)
        except index_builder.BuildCancelled:
            pass
        if not cancel.is_set():
            raise AssertionError("First attempt finished before exercising cancellation")
        with closing(sqlite3.connect(target)) as db:
            saved = db.execute("SELECT COUNT(*) FROM element_cold").fetchone()[0]
        assert saved > 0 and model_index.is_usable(target)
        attempt = 2
        cancel.clear()
        index_builder.prepare_model(str(source), model_hash, str(cache), on_progress=progress)
        with closing(sqlite3.connect(target)) as db:
            check = db.execute("PRAGMA quick_check").fetchone()[0]
            mode = db.execute("PRAGMA journal_mode").fetchone()[0]
            total = db.execute("SELECT COUNT(*) FROM element").fetchone()[0]
            count = db.execute("SELECT COUNT(*) FROM element_cold").fetchone()[0]
        resumed = next(e["completed"] for e in events if e["attempt"] == 2 and e["phase"] == "cold")
        assert resumed == saved and count == total and check == "ok" and mode == "wal"
    finally:
        stop.set()
        thread.join(3)
    ordered = sorted(latencies)
    result = {"source": str(source), "bytes": source.stat().st_size, "sqliteVersion": sqlite3.sqlite_version,
        "seconds": round(monotonic() - started, 3), "journalMode": mode, "integrity": check,
        "committedBeforeCancel": saved, "resumedAt": resumed, "total": total,
        "readSamples": len(ordered), "readP95Ms": round(ordered[int((len(ordered)-1) * .95)], 3),
        "readMaxMs": round(max(ordered), 3), "readErrors": failures, "events": events}
    (output / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "events"}, indent=2), flush=True)
    assert not failures


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
