from __future__ import annotations

from typing import Any

from model_runtime import active_index
from model_index import ModelIndex

DEFAULT_SEARCH_LIMIT = 100
MAX_SEARCH_LIMIT = 500
MAX_TREE_DEPTH = 32


def get_model_tree() -> dict[str, Any]:
    index = active_index()
    roots = index.roots()
    return {
        "ok": True,
        "roots": [_tree_node(index, root_id, set(), 0) for root_id in roots],
        "rootCount": len(roots),
    }


def search_model(
    q: str | None,
    ifc_type: str | None,
    limit: int,
) -> dict[str, Any]:
    bounded_limit = max(1, min(limit, MAX_SEARCH_LIMIT))
    query = (q or "").strip().lower()
    results, truncated = active_index().search(
        query, (ifc_type or "").strip(), bounded_limit
    )
    return {
        "ok": True,
        "query": q or "",
        "ifcType": ifc_type or "",
        "limit": bounded_limit,
        "returnedCount": len(results),
        "truncated": truncated,
        "results": results,
    }


def _tree_node(
    index: ModelIndex,
    express_id: int,
    path: set[int],
    depth: int,
) -> dict[str, Any]:
    summary = index.summary(express_id) or {
        "globalId": None,
        "expressId": express_id,
        "ifcType": "",
        "name": None,
        "objectType": None,
    }
    if express_id in path or depth >= MAX_TREE_DEPTH:
        return {**summary, "childCount": 0, "children": [], "truncated": True}

    children = index.children(express_id)
    next_path = {*path, express_id}
    return {
        **summary,
        "childCount": len(children),
        "children": [
            _tree_node(index, child["expressId"], next_path, depth + 1)
            for child in children
        ],
        "truncated": False,
    }
