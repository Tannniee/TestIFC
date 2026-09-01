"""Versioned SQLite cache for density-independent take-off facts."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import mass_facts

FACTS_SCHEMA_VERSION = 1
FACTS_ALGORITHM_VERSION = 1


def path_for(cache_dir: Path, model_hash: str) -> Path:
    return cache_dir / f"{model_hash}.facts-v{FACTS_SCHEMA_VERSION}.sqlite"


class FactsCache:
    """Store raw geometry/material facts without density or request policy."""

    def __init__(self, path: Path, model_hash: str) -> None:
        self.path = path
        self.model_hash = model_hash
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30.0)
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    def _ensure_schema(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS element_fact (
                  express_id INTEGER NOT NULL,
                  algorithm_version INTEGER NOT NULL,
                  fact_json TEXT NOT NULL,
                  PRIMARY KEY(express_id, algorithm_version)
                );
                """
            )
            connection.executemany(
                "INSERT INTO meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [
                    ("schema_version", str(FACTS_SCHEMA_VERSION)),
                    ("model_hash", self.model_hash),
                ],
            )
            connection.commit()

    def get_part(self, express_id: int) -> mass_facts.PartFacts | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT fact_json FROM element_fact "
                "WHERE express_id = ? AND algorithm_version = ?",
                (express_id, FACTS_ALGORITHM_VERSION),
            ).fetchone()
        if row is None:
            return None
        return mass_facts.part_facts_from_record(json.loads(row[0]))

    def put_part(self, facts: mass_facts.PartFacts) -> None:
        payload = json.dumps(
            mass_facts.part_facts_to_record(facts),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT INTO element_fact (express_id, algorithm_version, fact_json) "
                "VALUES (?, ?, ?) ON CONFLICT(express_id, algorithm_version) "
                "DO UPDATE SET fact_json = excluded.fact_json",
                (facts.entity_id, FACTS_ALGORITHM_VERSION, payload),
            )
            connection.commit()
