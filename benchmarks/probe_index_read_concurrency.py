"""Reproduce hot reads during a large, uncommitted cold-index write.

Uses a tiny in-memory IFC and an isolated temporary SQLite database. The JSON
describes the observed result; a readError is a detected concurrency problem.
"""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
from tempfile import TemporaryDirectory
from threading import Event, Thread
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import ifcopenshell
import model_index


def main():
    model = ifcopenshell.file(schema="IFC4")
    project = model.create_entity("IfcProject", GlobalId="0" * 22, Name="Probe")
    wall = model.create_entity("IfcWall", GlobalId="1" * 22, Name="Wall")
    model.create_entity("IfcDoor", GlobalId="2" * 22, Name="Door")
    waiting, release = Event(), Event()
    failures = []

    def cold(entity):
        if entity.id() == wall.id():
            waiting.set()
            if not release.wait(10):
                raise TimeoutError("Probe reader did not release the writer")
        return {"properties": {"large": "x" * 3_000_000}}

    with TemporaryDirectory(prefix="ifc-cold-read-probe-") as temporary:
        target = Path(temporary) / "index.sqlite"
        model_index.build_hot(
            model, target, "probe",
            lambda entity: {"expressId": entity.id(), "ifcType": entity.is_a(), "name": entity.Name},
            lambda _entity: [],
        )

        def build():
            try:
                model_index.build_cold(model, target, cold)
            except BaseException as error:
                failures.append(str(error))

        worker = Thread(target=build)
        worker.start()
        result = {}
        started = None
        try:
            if not waiting.wait(5):
                raise TimeoutError("Cold writer did not reach the probe barrier")
            started = perf_counter()
            with closing(sqlite3.connect(f"file:{target}?mode=ro", uri=True, timeout=0.25)) as connection:
                result["hotStatus"] = connection.execute(
                    "SELECT value FROM meta WHERE key='hot_status'"
                ).fetchone()[0]
                result["rootName"] = connection.execute(
                    "SELECT name FROM element WHERE express_id=?", (project.id(),)
                ).fetchone()[0]
        except sqlite3.OperationalError as error:
            result["readError"] = str(error)
        finally:
            if started is not None:
                result["readSeconds"] = round(perf_counter() - started, 3)
            release.set()
            worker.join(15)
        if worker.is_alive():
            raise TimeoutError("Cold writer did not finish")
        result["usableAfterCold"] = model_index.is_usable(target)
        result["workerErrors"] = failures
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
