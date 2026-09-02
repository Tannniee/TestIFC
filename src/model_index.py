"""Versioned SQLite semantic index with separate hot and cold data."""

from __future__ import annotations

import json
import os
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any, Callable, Iterable, Literal

import ifcopenshell

INDEX_SCHEMA_VERSION = 3
EXTRACTOR_VERSION = 1
INDEXED_TYPES = ("IfcProject", "IfcProduct", "IfcTypeProduct")
IndexStatus = Literal["not_configured", "indexing", "ready", "error"]

_SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE element (
  express_id INTEGER PRIMARY KEY,
  global_id TEXT,
  ifc_type TEXT NOT NULL,
  name TEXT,
  object_type TEXT,
  description TEXT,
  type_name TEXT,
  record_json TEXT NOT NULL
);
CREATE INDEX element_global_id ON element(global_id);
CREATE INDEX element_ifc_type ON element(ifc_type);
CREATE VIRTUAL TABLE element_fts USING fts5(
  name,
  description,
  object_type,
  type_name,
  classification,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE element_cold (
  express_id INTEGER PRIMARY KEY,
  record_json TEXT NOT NULL,
  FOREIGN KEY(express_id) REFERENCES element(express_id)
);
CREATE TABLE tree_edge (parent_id INTEGER NOT NULL, child_id INTEGER NOT NULL);
CREATE INDEX tree_edge_parent ON tree_edge(parent_id);
CREATE TABLE tree_root (express_id INTEGER PRIMARY KEY, ordinal INTEGER NOT NULL);
"""


def index_path_for(cache_dir: Path, model_hash: str) -> Path:
    return cache_dir / f"{model_hash}.semantic-v{INDEX_SCHEMA_VERSION}.sqlite"


def legacy_index_path_for(cache_dir: Path, model_hash: str) -> Path:
    """Return the pre-v2 location so migration code can identify old artifacts."""
    return cache_dir / f"{model_hash}.sqlite"


def _meta(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    try:
        with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as connection:
            row = connection.execute(
                "SELECT value FROM meta WHERE key = ?", (key,)
            ).fetchone()
        return str(row[0]) if row is not None else None
    except sqlite3.Error:
        return None


def is_usable(path: Path) -> bool:
    return (
        _meta(path, "schema_version") == str(INDEX_SCHEMA_VERSION)
        and _meta(path, "extractor_version") == str(EXTRACTOR_VERSION)
        and _meta(path, "hot_status") == "ready"
    )


def is_complete(path: Path) -> bool:
    return is_usable(path) and cold_status(path) == "ready"


def recover_interrupted_build(path: Path) -> None:
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("SELECT value FROM meta LIMIT 1").fetchone()


def cold_status(path: Path) -> IndexStatus:
    value = _meta(path, "cold_status")
    if value == "indexing":
        return "indexing"
    if value == "ready":
        return "ready"
    if value == "error":
        return "error"
    return "not_configured"


def cold_error(path: Path) -> str | None:
    return _meta(path, "cold_error")


def _set_meta(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def _type_text(record: dict, ifc_type: str) -> str:
    type_record = record.get("type")
    values = [ifc_type]
    if isinstance(type_record, dict):
        values.extend([type_record.get("ifcType"), type_record.get("name")])
    return " ".join(str(value) for value in values if value)


def _classification_text(record: dict) -> str:
    values = []
    for classification in record.get("classifications") or []:
        if not isinstance(classification, dict):
            continue
        values.extend([classification.get("identification"), classification.get("name")])
    return " ".join(str(value) for value in values if value)


def _fts_query(query: str) -> str | None:
    tokens = re.findall(r"[^\W_]+", query, flags=re.UNICODE)
    if not tokens:
        return None
    return " AND ".join(f'"{token.replace(chr(34), chr(34) * 2)}"*' for token in tokens)


def build_hot(
    ifc_file: ifcopenshell.file,
    target: Path,
    model_hash: str,
    build_record: Callable[[Any], dict],
    child_ids: Callable[[Any], Iterable[int]],
) -> int:
    """Atomically publish the minimum index required by tree/search/selection."""
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.with_suffix(".sqlite.partial")
    staging.unlink(missing_ok=True)
    connection = sqlite3.connect(staging)
    try:
        connection.executescript(_SCHEMA)
        connection.executemany(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            [
                ("schema_version", str(INDEX_SCHEMA_VERSION)),
                ("extractor_version", str(EXTRACTOR_VERSION)),
                ("model_hash", model_hash),
                ("hot_status", "indexing"),
                ("cold_status", "indexing"),
            ],
        )
        seen = set()
        rows = 0
        for entity in _indexed_entities(ifc_file):
            express_id = entity.id()
            if express_id in seen:
                continue
            seen.add(express_id)
            record = build_record(entity)
            ifc_type = str(record.get("ifcType") or entity.is_a())
            type_name = _type_text(record, ifc_type)
            connection.execute(
                "INSERT INTO element "
                "(express_id, global_id, ifc_type, name, object_type, description, type_name, record_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    express_id,
                    record.get("globalId"),
                    ifc_type,
                    record.get("name"),
                    record.get("objectType"),
                    record.get("description"),
                    type_name,
                    json.dumps(record, ensure_ascii=False, default=str),
                ),
            )
            connection.execute(
                "INSERT INTO element_fts "
                "(rowid, name, description, object_type, type_name, classification) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    express_id,
                    record.get("name"),
                    record.get("description"),
                    record.get("objectType"),
                    type_name,
                    "",
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
        _set_meta(connection, "hot_status", "ready")
        connection.commit()
    finally:
        connection.close()
    os.replace(staging, target)
    return rows


def build_cold(
    ifc_file: ifcopenshell.file,
    target: Path,
    build_record: Callable[[Any], dict],
) -> int:
    """Populate Psets, quantities, and other expensive semantic records."""
    if not is_usable(target):
        raise ValueError(f"hot semantic index is not usable: {target}")
    connection = sqlite3.connect(target)
    try:
        _set_meta(connection, "cold_status", "indexing")
        connection.execute("DELETE FROM meta WHERE key = 'cold_error'")
        connection.commit()
        rows = 0
        seen = set()
        for entity in _indexed_entities(ifc_file):
            express_id = entity.id()
            if express_id in seen:
                continue
            seen.add(express_id)
            record = build_record(entity)
            connection.execute(
                "INSERT INTO element_cold (express_id, record_json) VALUES (?, ?) "
                "ON CONFLICT(express_id) DO UPDATE SET record_json = excluded.record_json",
                (express_id, json.dumps(record, ensure_ascii=False, default=str)),
            )
            hot = connection.execute(
                "SELECT name, description, object_type, type_name "
                "FROM element WHERE express_id = ?",
                (express_id,),
            ).fetchone()
            if hot is not None:
                connection.execute(
                    "INSERT OR REPLACE INTO element_fts "
                    "(rowid, name, description, object_type, type_name, classification) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (express_id, *hot, _classification_text(record)),
                )
            rows += 1
        _set_meta(connection, "cold_status", "ready")
        connection.commit()
        return rows
    except BaseException as error:
        connection.rollback()
        _set_meta(connection, "cold_status", "error")
        _set_meta(connection, "cold_error", str(error))
        connection.commit()
        raise
    finally:
        connection.close()


def build(
    ifc_file: ifcopenshell.file,
    target: Path,
    model_hash: str,
    build_record: Callable[[Any], dict],
    child_ids: Callable[[Any], Iterable[int]],
    build_cold_record: Callable[[Any], dict] | None = None,
) -> int:
    """Build both tiers synchronously; retained for offline and unit workflows."""
    rows = build_hot(ifc_file, target, model_hash, build_record, child_ids)
    build_cold(ifc_file, target, build_cold_record or build_record)
    return rows


def _indexed_entities(ifc_file: ifcopenshell.file):
    for type_name in INDEXED_TYPES:
        try:
            yield from ifc_file.by_type(type_name)
        except RuntimeError:
            continue


class ModelIndex:
    """Read-only queries over one immutable semantic index."""

    def __init__(self, path: Path):
        self._path = path

    @property
    def cold_status(self) -> IndexStatus:
        return cold_status(self._path)

    def _query(self, sql: str, params=()):
        with closing(sqlite3.connect(f"file:{self._path}?mode=ro", uri=True)) as connection:
            return connection.execute(sql, params).fetchall()

    @staticmethod
    def _record(row) -> dict:
        hot = json.loads(row[0])
        cold = json.loads(row[1]) if row[1] is not None else {}
        return {**hot, **cold}

    def record_by_global_id(self, global_id: str) -> dict:
        rows = self._query(
            "SELECT e.record_json, c.record_json FROM element e "
            "LEFT JOIN element_cold c ON c.express_id = e.express_id "
            "WHERE e.global_id = ? LIMIT 1",
            (global_id,),
        )
        if not rows:
            raise LookupError(f"Element with GlobalId '{global_id}' not found")
        return self._record(rows[0])

    def record_by_express_id(self, express_id: int) -> dict:
        rows = self._query(
            "SELECT e.record_json, c.record_json FROM element e "
            "LEFT JOIN element_cold c ON c.express_id = e.express_id "
            "WHERE e.express_id = ? LIMIT 1",
            (express_id,),
        )
        if not rows:
            raise LookupError(f"Element with express id {express_id} not found")
        return self._record(rows[0])

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
            "SELECT e.global_id, e.express_id, e.ifc_type, e.name, e.object_type "
            "FROM tree_edge t JOIN element e ON e.express_id = t.child_id "
            "WHERE t.parent_id = ? ORDER BY e.ifc_type, COALESCE(e.name, ''), e.express_id",
            (express_id,),
        )
        return [_summary_row(row) for row in rows]

    def search(self, query: str, ifc_type: str, limit: int) -> tuple[list[dict], bool]:
        if not query:
            where = " WHERE ifc_type = ?" if ifc_type else ""
            params = (ifc_type, limit + 1) if ifc_type else (limit + 1,)
            rows = self._query(
                "SELECT global_id, express_id, ifc_type, name, object_type FROM element"
                f"{where} ORDER BY ifc_type, COALESCE(name, ''), express_id LIMIT ?",
                params,
            )
            return [_summary_row(row) for row in rows[:limit]], len(rows) > limit

        rows = self._query(
            "SELECT global_id, express_id, ifc_type, name, object_type FROM element "
            "WHERE global_id = ? AND (? = '' OR ifc_type = ?)",
            (query, ifc_type, ifc_type),
        )
        fts_query = _fts_query(query)
        if fts_query:
            rows.extend(
                self._query(
                    "SELECT e.global_id, e.express_id, e.ifc_type, e.name, e.object_type "
                    "FROM element_fts JOIN element e ON e.express_id = element_fts.rowid "
                    "WHERE element_fts MATCH ? AND (? = '' OR e.ifc_type = ?) "
                    "ORDER BY bm25(element_fts), e.ifc_type, COALESCE(e.name, ''), e.express_id "
                    "LIMIT ?",
                    (fts_query, ifc_type, ifc_type, limit + 1),
                )
            )
        unique = []
        seen = set()
        for row in rows:
            if row[1] in seen:
                continue
            seen.add(row[1])
            unique.append(row)
        return [_summary_row(row) for row in unique[:limit]], len(unique) > limit


def _summary_row(row) -> dict[str, Any]:
    return {
        "globalId": row[0],
        "expressId": row[1],
        "ifcType": row[2],
        "name": row[3],
        "objectType": row[4],
    }
