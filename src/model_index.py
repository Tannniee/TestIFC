"""SQLite-backed semantic index reconstructed from IFC Viewer 0.4.0."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any, Callable, Iterable

import ifcopenshell

INDEX_SCHEMA_VERSION = 1
INDEXED_TYPES = ("IfcProject", "IfcProduct", "IfcTypeProduct")

_SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE element (
  express_id INTEGER PRIMARY KEY,
  global_id TEXT,
  ifc_type TEXT NOT NULL,
  name TEXT,
  object_type TEXT,
  record_json TEXT NOT NULL
);
CREATE INDEX element_global_id ON element(global_id);
CREATE INDEX element_ifc_type ON element(ifc_type);
CREATE TABLE tree_edge (parent_id INTEGER NOT NULL, child_id INTEGER NOT NULL);
CREATE INDEX tree_edge_parent ON tree_edge(parent_id);
CREATE TABLE tree_root (express_id INTEGER PRIMARY KEY, ordinal INTEGER NOT NULL);
"""


def index_path_for(cache_dir: Path, model_hash: str) -> Path:
    return cache_dir / f"{model_hash}.sqlite"


def is_usable(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as connection:
            row = connection.execute(
                "SELECT value FROM meta WHERE key = 'schema_version'"
            ).fetchone()
        return row is not None and row[0] == str(INDEX_SCHEMA_VERSION)
    except sqlite3.Error:
        return False


def build(
    ifc_file: ifcopenshell.file,
    target: Path,
    model_hash: str,
    build_record: Callable[[Any], dict],
    child_ids: Callable[[Any], Iterable[int]],
) -> int:
    staging = target.with_suffix(".sqlite.partial")
    staging.unlink(missing_ok=True)
    connection = sqlite3.connect(staging)
    try:
        connection.executescript(_SCHEMA)
        connection.executemany(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            [("schema_version", str(INDEX_SCHEMA_VERSION)), ("model_hash", model_hash)],
        )
        seen = set()
        rows = 0
        for entity in _indexed_entities(ifc_file):
            express_id = entity.id()
            if express_id in seen:
                continue
            seen.add(express_id)
            record = build_record(entity)
            connection.execute(
                "INSERT INTO element (express_id, global_id, ifc_type, name, object_type, record_json) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    express_id,
                    record.get("globalId"),
                    str(record.get("ifcType") or entity.is_a()),
                    record.get("name"),
                    getattr(entity, "ObjectType", None),
                    json.dumps(record, ensure_ascii=False, default=str),
                ),
            )
            connection.executemany(
                "INSERT INTO tree_edge (parent_id, child_id) VALUES (?, ?)",
                [(express_id, child) for child in child_ids(entity)],
            )
            rows += 1
        connection.executemany(
            "INSERT INTO tree_root (express_id, ordinal) VALUES (?, ?)",
            [(root.id(), ordinal) for ordinal, root in enumerate(ifc_file.by_type("IfcProject"))],
        )
        connection.commit()
    finally:
        connection.close()
    target.unlink(missing_ok=True)
    staging.rename(target)
    return rows


def _indexed_entities(ifc_file: ifcopenshell.file):
    for type_name in INDEXED_TYPES:
        try:
            yield from ifc_file.by_type(type_name)
        except RuntimeError:
            continue


class ModelIndex:
    """Read-only queries over one immutable model index."""

    def __init__(self, path: Path):
        self._path = path

    def _query(self, sql: str, params=()):
        with closing(sqlite3.connect(f"file:{self._path}?mode=ro", uri=True)) as connection:
            return connection.execute(sql, params).fetchall()

    def record_by_global_id(self, global_id: str) -> dict:
        rows = self._query(
            "SELECT record_json FROM element WHERE global_id = ? LIMIT 1", (global_id,)
        )
        if not rows:
            raise LookupError(f"Element with GlobalId '{global_id}' not found")
        return json.loads(rows[0][0])

    def record_by_express_id(self, express_id: int) -> dict:
        rows = self._query(
            "SELECT record_json FROM element WHERE express_id = ? LIMIT 1", (express_id,)
        )
        if not rows:
            raise LookupError(f"Element with express id {express_id} not found")
        return json.loads(rows[0][0])

    def summary(self, express_id: int) -> dict | None:
        rows = self._query(
            "SELECT global_id, express_id, ifc_type, name, object_type FROM element WHERE express_id = ?",
            (express_id,),
        )
        return _summary_row(rows[0]) if rows else None

    def roots(self) -> list[int]:
        return [row[0] for row in self._query("SELECT express_id FROM tree_root ORDER BY ordinal")]

    def children(self, express_id: int) -> list[dict]:
        rows = self._query(
            "SELECT e.global_id, e.express_id, e.ifc_type, e.name, e.object_type FROM tree_edge t JOIN element e ON e.express_id = t.child_id WHERE t.parent_id = ? ORDER BY e.ifc_type, COALESCE(e.name, ''), e.express_id",
            (express_id,),
        )
        return [_summary_row(row) for row in rows]

    def search(self, query: str, ifc_type: str, limit: int) -> tuple[list[dict], bool]:
        clauses = []
        params = []
        if ifc_type:
            clauses.append("ifc_type = ?")
            params.append(ifc_type)
        if query:
            clauses.append(
                "(LOWER(COALESCE(global_id, '')) LIKE ? OR LOWER(COALESCE(name, '')) LIKE ? OR LOWER(COALESCE(object_type, '')) LIKE ? OR LOWER(ifc_type) LIKE ?)"
            )
            params.extend([f"%{query}%"] * 4)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit + 1)
        rows = self._query(
            "SELECT global_id, express_id, ifc_type, name, object_type FROM element"
            f"{where} ORDER BY ifc_type, COALESCE(name, ''), express_id LIMIT ?",
            tuple(params),
        )
        return [_summary_row(row) for row in rows[:limit]], len(rows) > limit


def _summary_row(row) -> dict[str, Any]:
    return {
        "globalId": row[0],
        "expressId": row[1],
        "ifcType": row[2],
        "name": row[3],
        "objectType": row[4],
    }
