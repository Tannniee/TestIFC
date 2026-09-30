"""Indexed BIM filters with set composition and complete keyset pagination."""
from __future__ import annotations

import math
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any


def _condition(condition: dict) -> tuple[str, list[Any]]:
    kind, name, prop, operator, value = (condition[key] for key in ("kind", "setName", "propertyName", "op", "value"))
    if kind not in {"pset", "qto"} or operator not in {"eq", "contains", "gt", "gte", "lt", "lte"}:
        raise ValueError("unsupported_semantic_filter")
    if not isinstance(name, str) or not name.strip() or not isinstance(prop, str) or not prop.strip():
        raise ValueError("semantic_field_required")
    params: list[Any] = [kind, name.strip(), prop.strip()]
    if operator == "contains":
        comparison = "value_text LIKE ? ESCAPE '\\'"
        params.append("%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    elif operator == "eq":
        comparison = "value_text = ? COLLATE NOCASE"
        params.append(value)
        try:
            numeric = float(value)
            if math.isfinite(numeric):
                comparison = "(value_text = ? COLLATE NOCASE OR value_number = ?)"
                params.append(numeric)
        except ValueError:
            pass
    else:
        try:
            numeric = float(value)
        except ValueError as error:
            raise ValueError("numeric_value_required") from error
        if not math.isfinite(numeric):
            raise ValueError("numeric_value_required")
        comparator = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[operator]
        comparison = f"value_number {comparator} ?"
        params.append(numeric)
    return ("SELECT express_id FROM semantic_value WHERE kind = ? AND set_name = ? COLLATE NOCASE "
            f"AND property_name = ? COLLATE NOCASE AND {comparison}", params)


def filter_values(path: Path, status: str, conditions: list[dict], match: str, ifc_type: str,
                  cursor: int, limit: int) -> dict:
    if not 1 <= len(conditions) <= 8 or match not in {"all", "any"}:
        raise ValueError("unsupported_semantic_filter")
    if not 1 <= limit <= 500 or cursor < 0:
        raise ValueError("invalid_semantic_page")
    compiled = [_condition(condition) for condition in conditions]
    if status != "ready":
        return {"coldStatus": status, "results": [], "total": 0, "truncated": False, "nextCursor": None}
    join = " INTERSECT " if match == "all" else " UNION "
    cte = "WITH matched AS (" + join.join(sql for sql, _ in compiled) + ") "
    params = [value for _, values in compiled for value in values]
    where = " WHERE e.browser_element = 1" + (" AND e.ifc_type = ?" if ifc_type else "")
    if ifc_type:
        params.append(ifc_type)
    source = " FROM element e JOIN matched m ON m.express_id = e.express_id" + where
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=.75)) as connection:
        connection.execute("BEGIN")
        total = connection.execute(cte + "SELECT COUNT(*)" + source, params).fetchone()[0]
        rows = connection.execute(cte + "SELECT e.express_id,e.global_id,e.ifc_type,e.name" + source
                                  + " AND e.express_id > ? ORDER BY e.express_id LIMIT ?",
                                  [*params, cursor, limit + 1]).fetchall()
    return {"coldStatus": status, "total": total, "truncated": len(rows) > limit,
            "nextCursor": rows[limit-1][0] if len(rows) > limit else None,
            "results": [{"localId": row[0], "globalId": row[1], "ifcType": row[2], "name": row[3]}
                        for row in rows[:limit]]}


def field_catalog(path: Path, status: str) -> dict:
    if status != "ready":
        return {"coldStatus": status, "fields": [], "truncated": False}
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=.75)) as connection:
        rows = connection.execute("SELECT kind,set_name,property_name,unit,COUNT(DISTINCT express_id) "
                                  "FROM semantic_value GROUP BY kind,set_name,property_name,unit "
                                  "ORDER BY kind,set_name COLLATE NOCASE,property_name COLLATE NOCASE LIMIT 2001").fetchall()
    return {"coldStatus": status, "truncated": len(rows) > 2000,
            "fields": [{"kind": row[0], "setName": row[1], "propertyName": row[2], "unit": row[3], "count": row[4]}
                       for row in rows[:2000]]}
