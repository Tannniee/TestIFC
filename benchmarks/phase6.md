# Phase 6 scale-hardening contract

Semantic DB v3 uses SQLite FTS5 for `Name`, `Description`, `ObjectType`, assigned
type, and classification text. GlobalId lookup remains an exact `=` query backed
by the `element_global_id` B-tree index. Reusing a v2 cache triggers one semantic
rebuild; fragment and facts versions remain independent.

Index preparation uses an atomic per-model build lock. A restarted server reuses
the published hot index while the original cold build finishes; it cannot start a
second writer for the same semantic target. Retention treats the lock as a live
build marker and removes abandoned locks after two hours.

Fragment HTTP routes accept the versioned profile key
`<hash>.fragments-v2-<profile>`, while activation routes continue to accept only a
64-character model hash. This separation lets profile A/B results coexist without
weakening model identity validation.

Cache retention applies both limits:

```text
IFC_CACHE_KEEP_MODELS=3
IFC_CACHE_MAX_BYTES=10737418240
```

The byte total includes IFC, fragment profiles, semantic SQLite, facts SQLite,
and recursive RocksDB contents. Retention never evicts the active model, a pinned
session, a live partial upload, or a bundle with an artifact being built. Stale
partial artifacts remain eligible for cleanup after 24 hours.

Run the browser lifecycle test with:

```powershell
cd frontend
pnpm exec playwright install chromium
pnpm run test:e2e
```

The test remounts the viewer 20 times. It requires one canvas, one active viewer,
balanced lifecycle counters, and post-GC heap growth no greater than 16 MiB. The
Windows release workflow also launches the packaged PyWebView application with a
WebView2 debugging port and connects through Playwright CDP.

Set `IFC_E2E_MODEL_PATH` while a source backend is running to enable the private
real-model test. It opens the same IFC twice, requires the second load to use the
fragment cache, keeps one canvas, and verifies hot and cold semantic readiness.

`.github/workflows/ci.yml` runs Python, frontend unit tests, Svelte/TypeScript,
the production build, and browser E2E on pull requests and `main`. The Windows
release workflow repeats the gates, creates the one-file executable, verifies the
HTTP bridge and packaged SPA, exercises WebView2 over CDP, and uploads the EXE.

Real IFC benchmark manifests and results remain local. Use
`benchmarks/run_backend_baseline.py` before and after a schema or search change;
compare results only on the same machine and byte-identical corpus.
