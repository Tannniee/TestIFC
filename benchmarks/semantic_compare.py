"""Measure fresh semantic indexes and fingerprint their logical contents."""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import index_builder


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    results = []
    for source in sorted(args.models.glob('*.ifc'), key=lambda p: p.stat().st_size):
        with TemporaryDirectory(prefix='ifc-semantic-compare-') as temporary:
            started = perf_counter()
            index_builder._worker(str(source), source.stem, temporary)
            elapsed = perf_counter() - started
            database = next(Path(temporary).glob('*.sqlite'))
            fingerprints = {}
            with closing(sqlite3.connect(database)) as db:
                for table in ('element', 'element_cold', 'element_fts', 'tree_edge', 'tree_root'):
                    rows = sorted(db.execute(f'SELECT * FROM {table}').fetchall(), key=repr)
                    digest = hashlib.sha256(json.dumps(rows, ensure_ascii=False).encode()).hexdigest()
                    fingerprints[table] = {'rows': len(rows), 'sha256': digest}
            result = {'file': source.name, 'bytes': source.stat().st_size,
                      'seconds': elapsed, 'tables': fingerprints}
            results.append(result)
            print(json.dumps(result), flush=True)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(results, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
