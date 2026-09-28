"""Versioned SQLite semantic index with separate hot and cold data."""

from __future__ import annotations

import json
import math
import os
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from time import monotonic, sleep
from typing import Any, Callable, Iterable, Literal

import ifcopenshell

from ifc_georeference import inspect_georeference

INDEX_SCHEMA_VERSION = 5
EXTRACTOR_VERSION = 3
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
  browser_element INTEGER NOT NULL,
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
CREATE TABLE browser_facet (
  view TEXT NOT NULL,
  facet_key TEXT NOT NULL,
  label TEXT NOT NULL,
  express_id INTEGER NOT NULL,
  PRIMARY KEY(view, facet_key, express_id)
);
CREATE INDEX browser_facet_element ON browser_facet(express_id);
CREATE TABLE semantic_value (
  kind TEXT NOT NULL,
  set_name TEXT NOT NULL,
  property_name TEXT NOT NULL,
  express_id INTEGER NOT NULL,
  value_text TEXT NOT NULL,
  value_number REAL,
  unit TEXT
);
CREATE INDEX semantic_value_text ON semantic_value(kind, set_name, property_name, value_text);
CREATE INDEX semantic_value_number ON semantic_value(kind, set_name, property_name, value_number);
CREATE INDEX semantic_value_element ON semantic_value(express_id);
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
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=0.75)) as connection:
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
    """Run only after the owned writer has exited, while holding its build lock."""
    for attempt in range(6):
        try:
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("SELECT value FROM meta LIMIT 1").fetchone()
                connection.execute("PRAGMA wal_checkpoint(PASSIVE)")
            return
        except sqlite3.OperationalError as error:
            # Windows may retain a crashed process's mapped WAL handles briefly.
            # Reopen the connection; never delete WAL or hide other I/O failures.
            if (os.name != "nt" or attempt == 5
                    or getattr(error, "sqlite_errorcode", None) != sqlite3.SQLITE_IOERR_TRUNCATE):
                raise
            sleep(0.02 * (attempt + 1))


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


def _browser_facets(record: dict, *, cold: bool) -> list[tuple[str, str, str]]:
    """Stable facet identity and display text, without Pset/Qto payloads."""
    result: list[tuple[str, str, str]] = []
    if not cold:
        for view, field in (("types", "type"), ("material", "material")):
            value = record.get(field)
            if isinstance(value, dict) and value.get("expressId") is not None:
                key = str(value["expressId"])
                result.append((view, key, str(value.get("name") or value.get("ifcType") or key)))
    else:
        for view, field in (("systems", "systems"), ("groups", "groups"),
                            ("classification", "classifications")):
            for value in record.get(field) or []:
                if not isinstance(value, dict):
                    continue
                key = str(value.get("expressId") or value.get("identification") or value.get("name") or "")
                if key:
                    label = value.get("name") or value.get("identification") or key
                    result.append((view, key, str(label)))
    return result


def _is_browser_element(entity: Any, ifc_type: str) -> bool:
    try:
        return bool(entity.is_a("IfcProduct") and not entity.is_a("IfcSpatialElement")
                    and not entity.is_a("IfcSpatialStructureElement"))
    except TypeError:  # Minimal test doubles only implement is_a().
        return ifc_type not in {"IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey"}


def _quantity_unit(name: str, units: dict) -> str | None:
    lowered = name.lower()
    for suffix, field in (("volume", "volumeUnit"), ("area", "areaUnit"),
                          ("weight", "massUnit"), ("mass", "massUnit"),
                          ("length", "lengthUnit"), ("width", "lengthUnit"),
                          ("height", "lengthUnit"), ("perimeter", "lengthUnit")):
        if lowered.endswith(suffix):
            return units.get(field)
    return None


def _semantic_values(record: dict) -> list[tuple[str, str, str, str, float | None, str | None]]:
    """Flatten scalar Pset/Qto leaves while keeping original records untouched."""
    rows = []
    units = record.get("units") or {}
    for kind, field in (("pset", "properties"), ("qto", "quantities")):
        sets = record.get(field) or {}
        if not isinstance(sets, dict):
            continue
        for set_name, properties in sets.items():
            if not isinstance(properties, dict):
                continue
            stack = [(str(name), value) for name, value in properties.items() if name != "id"]
            while stack:
                name, value = stack.pop()
                if isinstance(value, dict):
                    stack.extend((f"{name}.{child}", item) for child, item in value.items() if child != "id")
                elif isinstance(value, list):
                    stack.extend((f"{name}[{index}]", item) for index, item in enumerate(value))
                elif value is not None and isinstance(value, bool | int | float | str):
                    number = float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None
                    if number is not None and not math.isfinite(number):
                        continue
                    text = str(value).lower() if isinstance(value, bool) else str(value)
                    rows.append((kind, str(set_name), name, text, number,
                                 _quantity_unit(name, units) if kind == "qto" else None))
    return rows


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
    *, on_progress: Callable[[int, int | None, str | None], None] = lambda *_: None,
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
        _set_meta(connection, "georeference", json.dumps(inspect_georeference(ifc_file)))
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
                "(express_id, global_id, ifc_type, name, object_type, description, type_name, browser_element, record_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    express_id,
                    record.get("globalId"),
                    ifc_type,
                    record.get("name"),
                    record.get("objectType"),
                    record.get("description"),
                    type_name,
                    int(_is_browser_element(entity, ifc_type)),
                    json.dumps(record, ensure_ascii=False, default=str),
                ),
            )
            if _is_browser_element(entity, ifc_type):
                connection.executemany(
                    "INSERT OR IGNORE INTO browser_facet (view, facet_key, label, express_id) VALUES (?, ?, ?, ?)",
                    ((*facet, express_id) for facet in _browser_facets(record, cold=False)),
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
            on_progress(rows, None, ifc_type)
        connection.executemany(
            "INSERT INTO tree_root (express_id, ordinal) VALUES (?, ?)",
            [(root.id(), ordinal) for ordinal, root in enumerate(ifc_file.by_type("IfcProject"))],
        )
        _set_meta(connection, "hot_status", "ready")
        connection.commit()
    finally:
        connection.close()
    if target.exists():
        with target.open("rb") as existing:
            wal_header = existing.read(20)[18:20] == b"\x02\x02"
        if wal_header or Path(str(target) + "-wal").exists():
            # Never separate a previous database from its committed WAL. Refuse
            # replacement if a reader still owns the old generation.
            with closing(sqlite3.connect(target, timeout=0.75)) as previous:
                if previous.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]:
                    raise RuntimeError("Previous semantic index is still in use; retry after its readers finish")
                if previous.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
                    raise RuntimeError("Previous semantic WAL could not be closed")
    os.replace(staging, target)
    on_progress(rows, rows, None)
    return rows


def build_cold(
    ifc_file: ifcopenshell.file,
    target: Path,
    build_record: Callable[[Any], dict],
    *, on_progress: Callable[[int, int | None, str | None], None] = lambda *_: None,
) -> int:
    """Extract outside write transactions; commit bounded, resumable batches."""
    if not is_usable(target):
        raise ValueError(f"hot semantic index is not usable: {target}")
    connection = sqlite3.connect(target)
    try:
        # This is the only writable connection while the build lock is held.
        # Keep checkpoints on this same connection; API readers are read-only.
        if connection.execute("PRAGMA journal_mode=WAL").fetchone()[0] != "wal":
            raise RuntimeError("Semantic index cache does not support WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA wal_autocheckpoint=1000")
        connection.execute("PRAGMA journal_size_limit=16777216")
        _set_meta(connection, "cold_status", "indexing")
        connection.execute("DELETE FROM meta WHERE key = 'cold_error'")
        connection.commit()
        total = connection.execute("SELECT COUNT(*) FROM element").fetchone()[0]
        completed = {row[0] for row in connection.execute("SELECT express_id FROM element_cold")}
        rows = len(completed)
        on_progress(rows, total, None)
        pending = []
        pending_bytes = 0
        batch_started = monotonic()

        def flush():
            nonlocal pending_bytes, batch_started
            if not pending:
                return
            try:
                ids = [item[0] for item in pending]
                placeholders = ','.join('?' for _ in ids)
                hot_rows = dict((row[0], row[1:]) for row in connection.execute(
                    "SELECT express_id, name, description, object_type, type_name "
                    f"FROM element WHERE express_id IN ({placeholders})", ids,
                ))
                connection.executemany(
                    "INSERT INTO element_cold (express_id, record_json) VALUES (?, ?)",
                    ((express_id, encoded) for express_id, encoded, _, _, _ in pending),
                )
                connection.executemany(
                    "INSERT OR IGNORE INTO browser_facet (view, facet_key, label, express_id) VALUES (?, ?, ?, ?)",
                    ((*facet, express_id) for express_id, _, _, facets, _ in pending for facet in facets),
                )
                connection.executemany(
                    "INSERT INTO semantic_value "
                    "(kind, set_name, property_name, express_id, value_text, value_number, unit) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ((kind, set_name, property_name, express_id, value_text, value_number, unit)
                     for express_id, _, _, _, values in pending
                     for kind, set_name, property_name, value_text, value_number, unit in values),
                )
                connection.executemany(
                    "INSERT OR REPLACE INTO element_fts "
                    "(rowid, name, description, object_type, type_name, classification) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    ((express_id, *hot_rows[express_id], classification)
                     for express_id, _, classification, _, _ in pending if express_id in hot_rows),
                )
                _set_meta(connection, "cold_completed", str(rows))
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
            pending.clear()
            pending_bytes = 0
            batch_started = monotonic()

        seen = set(completed)
        for entity in _indexed_entities(ifc_file):
            express_id = entity.id()
            if express_id in seen:
                continue
            seen.add(express_id)
            # No write transaction is held while the native extractor runs.
            record = build_record(entity)
            encoded = json.dumps(record, ensure_ascii=False, default=str)
            pending.append((express_id, encoded, _classification_text(record),
                            _browser_facets(record, cold=True), _semantic_values(record)))
            pending_bytes += len(encoded.encode("utf-8"))
            rows += 1
            if len(pending) >= 128 or pending_bytes >= 4 * 1024 * 1024 or monotonic() - batch_started >= 0.5:
                flush()
            on_progress(rows, total, str(record.get("ifcType") or entity.is_a()))
        flush()
        _set_meta(connection, "cold_status", "ready")
        connection.commit()
        connection.execute("PRAGMA wal_checkpoint(PASSIVE)")
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

    def georeference(self) -> dict[str, Any]:
        rows = self._query("SELECT value FROM meta WHERE key = 'georeference'")
        return json.loads(rows[0][0]) if rows else {"status": "unavailable", "source": None,
                                                  "reason": "not_indexed"}

    def browser(self, view: str) -> dict[str, Any]:
        if view not in {"spatial", "systems", "types", "groups", "classification", "material"}:
            raise ValueError("unsupported browser view")
        elements = [
            {"localId": row[0], "globalId": row[1], "ifcType": row[2], "name": row[3]}
            for row in self._query(
                "SELECT express_id, global_id, ifc_type, name FROM element "
                "WHERE browser_element = 1 ORDER BY express_id"
            )
        ]
        facets = [] if view == "spatial" else [
            {"key": row[0], "label": row[1], "localId": row[2]}
            for row in self._query(
                "SELECT facet_key, label, express_id FROM browser_facet "
                "WHERE view = ? ORDER BY label COLLATE NOCASE, facet_key, express_id", (view,)
            )
        ]
        return {"coldStatus": self.cold_status, "elements": elements, "facets": facets}

    def semantic_search(self, kind: str, set_name: str, property_name: str, operator: str,
                        value: str, ifc_type: str, limit: int) -> dict[str, Any]:
        if kind not in {"pset", "qto"} or operator not in {"eq", "contains", "gt", "gte", "lt", "lte"}:
            raise ValueError("unsupported semantic filter")
        if not 1 <= limit <= 500:
            raise ValueError("semantic filter limit must be 1..500")
        status = self.cold_status
        if status != "ready":
            return {"coldStatus": status, "results": [], "truncated": False}
        clause = "v.value_text = ? COLLATE NOCASE"
        parameter: str | float = value
        numeric_equal: float | None = None
        if operator == "eq":
            try:
                parsed = float(value)
                if math.isfinite(parsed):
                    numeric_equal = parsed
                    clause = "(v.value_text = ? COLLATE NOCASE OR v.value_number = ?)"
            except ValueError:
                pass
        elif operator == "contains":
            clause = "v.value_text LIKE ? ESCAPE '\\'"
            parameter = "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        elif operator != "eq":
            try:
                parameter = float(value)
            except ValueError as error:
                raise ValueError("numeric_value_required") from error
            if not math.isfinite(parameter):
                raise ValueError("numeric_value_required")
            comparator = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[operator]
            clause = f"v.value_number {comparator} ?"
        where_type = " AND e.ifc_type = ?" if ifc_type else ""
        params = (kind, set_name, property_name, parameter,
                  *((numeric_equal,) if numeric_equal is not None else ()),
                  *((ifc_type,) if ifc_type else ()), limit + 1)
        rows = self._query(
            "SELECT e.express_id, e.global_id, e.ifc_type, e.name, v.value_text, v.unit "
            "FROM semantic_value v JOIN element e ON e.express_id = v.express_id "
            f"WHERE v.kind = ? AND v.set_name = ? COLLATE NOCASE "
            f"AND v.property_name = ? COLLATE NOCASE AND {clause}{where_type} "
            "GROUP BY e.express_id ORDER BY e.express_id LIMIT ?", params,
        )
        return {"coldStatus": status, "truncated": len(rows) > limit,
                "results": [{"localId": row[0], "globalId": row[1], "ifcType": row[2],
                             "name": row[3], "value": row[4], "unit": row[5]}
                            for row in rows[:limit]]}

    def _query(self, sql: str, params=()):
        with closing(sqlite3.connect(self._path.resolve().as_uri() + "?mode=ro", uri=True, timeout=0.75)) as connection:
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
