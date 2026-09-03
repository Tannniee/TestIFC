# IFC backend performance baseline

This directory defines the Phase 0 benchmark contract. It measures the current
backend boundaries without bundling customer or project IFC files.

For the real-browser large-model workflow (geometry, navigation, tools, memory,
cache reopen and unload), see [large-models.md](large-models.md).

1. Copy `corpus.example.json` to `corpus.local.json`.
2. Replace each example path with a sanitized or locally controlled IFC file.
3. Add `expectedSha256` when the file must be byte-for-byte stable.
4. Run `..\.venv\Scripts\python.exe .\run_backend_baseline.py` from this
   directory, or use the command shown in the root README.

Each result records file identity, file size, indexed element count, and elapsed
seconds for SHA-256 hashing, IFC open, semantic-index preparation, and configured
searches. Compare result files from the same machine and corpus. Do not compare
single timings from different machines as if they were equivalent.

`corpus.local.json` and `results/` are intentionally ignored. Keep real project
models outside Git.

`run_semantic_wal.py <IFC path> <new output directory>` exercises cold-index WAL
with concurrent readers, cancels a partial build, then resumes it and verifies
the database. Use a new output directory so the benchmark cannot modify an
existing model cache.

Phase 6 comparisons should use the same manifest twice: once before the semantic
schema change and once after it. Keep both JSON files under `results/`; the folder
is ignored so project paths, hashes, and measurements stay local.
