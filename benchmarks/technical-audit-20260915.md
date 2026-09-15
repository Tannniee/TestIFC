# IFC Viewer 1.0.3 technical performance audit

Date: 2026-09-15
Scope: measurement and diagnosis before production implementation

## Boundaries

- No production source was changed during this audit.
- Audit-only changes were made to `benchmarks/run_large_models.mjs`,
  `benchmarks/serve_benchmark.py`, and `benchmarks/corpus.audit-very-large.json`.
- Browser/Vite evidence is not packaged-WebView2 evidence.
- The checkout has no `.git` directory or build manifest, so source/EXE identity
  cannot be proven beyond matching version and the recorded artifact hash.

## Identified runtime

- Source version: 1.0.3
- Release artifact: `BUILD RELEASE/IFC Viewer 1.0.3.exe`
- Release bytes: 67,329,029
- Release SHA-256: `74C518F988CF7465189D3632406BCB41BF00287A3C945DE3C3C160B406D8181A`
- Python: 3.14.7
- IfcOpenShell: 0.8.5
- Node: 24.19.0
- Vite: 8.2.2
- WebIFC: 0.0.77
- Fragments: 3.4.7

## Executive findings

### P0: the current WebIFC path cannot open AMTIEN

`AMTIEN_DOME_Combined_rev2.ifc`:

- 1,911,402,186 bytes
- SHA-256 `D0584CBDA094260D985A419BDBDD69489D8B590882B25787DDBB1A2052E3E60B`

Both `full` and `minimum` profiles failed at the same point:

- phase: WebIFC `geometries`
- progress: 0.178571
- entities processed: 2,926
- category: `IFCCOLUMN`
- elapsed: 23.70 s (`full`), 22.74 s (`minimum`)
- error: `bad_alloc was thrown in -fno-exceptions mode`
- terminal error: `Aborted(native code called abort())`
- peak process-tree private memory: 7.45 GiB
- minimum available physical RAM: 36.23 GiB

This is a WebAssembly/WebIFC allocation limit, not exhaustion of physical RAM.
The failure occurs before optional attribute/relation extraction, so changing the
metadata profile cannot solve it.

The current checkout contains no native geometry pipeline or large-model
fallback. Therefore 1.0.3 has no viable path for this model.

Raw evidence:

- `results/audit-amtien-full-1/summary.json`
- `results/audit-amtien-minimum-1/summary.json`

### P1: cache retention breaks valid warm activation

The authenticated end-to-end benchmark completed cold geometry and full semantic
indexing, then warm load failed with `staged_model_file_changed`.

Root cause:

1. A staged transaction fingerprints `(size, mtime_ns, inode)`.
2. Cache retention calls `os.utime()` on protected bundle files to record recency.
3. Retention changes `mtime` without changing IFC contents.
4. Transaction commit interprets this recency update as source mutation.

A deterministic fixture reproduced the conflict:

```text
mtime_changed True
commit TransactionConflict staged_model_file_changed
```

Existing tests cover real byte mutation but do not cover retention touching a
pinned file between prepare and commit.

Affected source:

- `src/model_transactions.py:19-33, 61-78, 93-98`
- `src/model_cache.py:229-233`

Raw evidence:

- `results/deep-audit-authenticated-20260915/summary.json`

### P1: RocksDB more than doubles semantic build time at 304 MB

ABBA-style fresh-cache comparison on the same 304,249,606-byte model:

| Mode | Run 1 | Run 2 | Median |
|---|---:|---:|---:|
| Direct IFC | 110.95 s | 107.20 s | 109.08 s |
| Fresh RocksDB | 231.62 s | 235.84 s | 233.73 s |

Direct IFC was 53.3% faster by median. Logical SHA-256 fingerprints matched for
all five tables and all 180,070 indexed entities.

An earlier phase-instrumented pair showed why:

| Phase | Direct IFC | RocksDB |
|---|---:|---:|
| Prepare/open | 13.71 s | 53.24 s |
| Hot index | 25.56 s | 43.41 s |
| Cold index | 86.85 s | 162.42 s |
| Total | 126.11 s | 259.07 s |

RocksDB adds conversion cost and slows subsequent relation-heavy traversal. The
current fixed threshold of 256 MiB is not suitable for this model.

Raw evidence:

- `results/audit-semantic-direct-1.json`
- `results/audit-semantic-direct-2.json`
- `results/audit-semantic-rocks-1.json`
- `results/audit-semantic-rocks-2.json`

### P1: repeated semantic relation traversal is the main backend CPU cost

The profile run made 567,858,081 calls. Profiling inflated total wall time, so
cumulative values are for ranking rather than normal runtime prediction.

Main costs:

- `build_cold_record`: 170.73 s cumulative
- `get_psets`: 121.03 s cumulative
- entity `__getattr__`: 97.07 s cumulative, 12.66 million calls
- quantity normalization: 28.56 s cumulative
- classification lookup: 15.63 s cumulative
- SQLite/batching overhead around cold extraction: about 10 s cumulative

The worker used about one CPU core during cold extraction. More RAM, a faster
GPU, or another NVMe SSD will not materially improve this phase.

### P2: `minimum` improves 304 MB cold geometry but loses metadata

Single controlled observations:

| Profile | First render | Conversion | Complete | Fragment | Peak private |
|---|---:|---:|---:|---:|---:|
| full | 47.91 s | 42.52 s | 54.19 s | 42.91 MiB | 6.50 GiB |
| attributes | 45.51 s | 40.26 s | 51.26 s | 42.91 MiB | 6.31 GiB |
| minimum | 38.66 s | 34.01 s | 43.66 s | 31.16 MiB | 5.23 GiB |

`minimum` improved first render by 19.3%, reduced fragment bytes by 27.4%, and
reduced peak private memory by 19.5% in this run.

However, a deterministic property probe on Express ID 29014 found:

- full: 130 values
- attributes: 130 values, identical digest to full
- minimum: 121 values

Missing or degraded data included:

- `IfcDoorLiningProperties`
- `IfcDoorPanelProperties`
- `PanelOperation`
- `PanelPosition`
- OwnerHistory fields
- category/GUID identity on these nested property objects

`minimum` is not safe as the default until the product defines which metadata is
required or the backend semantic index supplies a compatible fallback.

Two existing E2E assertions are stale: they require attributes/minimum to show
“Không có dữ liệu quan hệ”, but the real medium model returns extensive Pset/Qto
data in both profiles. Those tests failed because data was present, not missing.

Raw evidence:

- `results/audit-geometry-full-1/summary.json`
- `results/audit-geometry-attributes-1/summary.json`
- `results/audit-geometry-minimum-1/summary.json`
- `results/audit-properties-full-entries/summary.json`
- `results/audit-properties-minimum-entries/summary.json`

### P3: semantic scheduling is not the cold-conversion bottleneck

Semantic indexing starts during backend commit, after the first rendered model
frame. Disabling semantic changed the first-render-to-ready interval by only
about 0.3-0.4 s in the observed full-profile runs.

WebIFC conversion varied by about four seconds between runs before semantic had
started. Delay-semantic work is therefore lower priority than WebIFC metadata,
RocksDB, and relation extraction work.

## Correct interpretation of the 254-second observation

The previous approximately 254-second number measured complete backend semantic
preparation, not model opening.

Three full-profile source/browser observations on the 304 MB model gave:

- first render median: about 47.91 s
- load completion median: about 54.19 s
- conversion median: about 42.52 s

The viewer is usable long before cold semantic completion. UI reporting and
benchmark names must preserve this distinction.

## Hardware conclusion

For the 304 MB model, the constraints are predominantly software:

- 24 logical CPU cores are available, but WebIFC and semantic traversal use only
  about 1-3 core equivalents.
- Tens of GiB of RAM remain available.
- Disk throughput is far below NVMe capability during sampled semantic work.
- The RTX 5090 renders the loaded model smoothly but does not accelerate IFC
  parsing or semantic extraction.

For AMTIEN, the failure is still software architecture: WebIFC aborts on its own
allocation boundary while physical RAM remains abundant.

## Current validation gates

- Python: 177/177 passed
- Frontend unit tests: 35/35 passed
- Svelte check: 0 errors, 0 warnings
- Large full/attributes/minimum cold geometry tool checks passed on 304 MB
- AMTIEN full/minimum both failed reproducibly in WebIFC geometry
- Warm-cache end-to-end is blocked by the retention/fingerprint conflict

Passing unit/static gates does not cover either confirmed production failure.

## Recommended implementation order

1. Fix the retention/fingerprint false conflict and add a deterministic
   prepare-retention-commit regression test.
2. Remove or raise the RocksDB threshold for the measured 304 MB range, preserve
   the logical fingerprint gate, and repeat interleaved measurements.
3. Reduce repeated Pset/Qto/relation traversal through precomputed relation maps
   or lazy cold properties. Do not begin with more SQLite tuning.
4. Define the required metadata contract. Evaluate a selective profile between
   `full` and `minimum`; do not switch to `minimum` blindly.
5. Restore a bounded, isolated large-model geometry fallback with coverage,
   cancellation, rollback, checksum, and disposal guarantees. WebIFC settings or
   profile changes cannot solve AMTIEN.
6. After source gates pass, rebuild into `BUILD RELEASE` and run packaged WebView2
   cold, warm, selection, section, unload, and process-cleanup validation.

## Implementation acceptance gates

- Warm activation survives retention without weakening real mutation detection.
- Direct-vs-candidate semantic fingerprints remain identical.
- 304 MB semantic median improves by at least 40% from the current RocksDB path.
- 304 MB first render does not regress.
- Required Pset/Qto/type/material/identity data remains available.
- AMTIEN either opens through a verified fallback or fails early with a bounded,
  recoverable error; it must not abort the conversion worker unexpectedly.
- Packaged WebView2 evidence is recorded separately from source/browser evidence.

## Audit artifacts and cleanup

Audit result directories currently occupy about 6.9 GiB, mostly isolated copies
of IFC inputs and temporary caches. They were retained as raw evidence. Once the
implementation decision is accepted, cache subdirectories can be removed while
preserving JSON summaries, logs, screenshots, and resource traces.
