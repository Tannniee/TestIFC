# Changelog

## 1.0.3 — 2026-09-03

- Add document tabs and independent view sessions for multi-IFC workspaces,
  with transactional model switching, cancellation, rollback and cache/source recovery.
- Create Section Box views by sweeping a rectangle in Top View. Preserve camera,
  clipping, selection and measurements separately for each view.
- Add Project Browser and Properties, virtualized model rows, element properties,
  Section Box controls and smooth panel transitions. Move the toolbox beside Browser.
- Add selection-centered orbit directly below PAN and a saved rotation-speed option.
  Keep wheel zoom centered on the selected element and reject stale pivot queries.
- Make model-loading progress compact and theme-aware, place measurement input near
  the picked point, and use INDEX terminology for semantic readiness.
- Add fragment cache cleanup with protection for active and staging models. Remove
  the estimated memory admission limit while retaining transactional cleanup.
- Set application, API, frontend, Windows metadata and desktop logs to 1.0.3.
  Package the EXE locally; publish source with tag `v1.0.3` and skip Actions for this upload.

## 1.0.2 — 2026-09-03

- Set the application, API, frontend, Windows executable metadata and structured
  desktop logs to version 1.0.2; release the source under tag `v1.0.2`.
- Show overall and per-stage model-loading progress, with Cancel and protection
  against stale callbacks after cancellation or reopening a model.
- Render on demand, coalesce fragment updates and reduce rendering cost while
  navigating dense models; restore display resolution when navigation stops.
- Extract `ViewerModelLoader` and own conversion, fragment and semantic workers
  through cancellation, shutdown and model changes.
- Reserve the actual server socket and protect the internal API with a per-launch
  session, loopback Host/Origin checks and structured cache-operation logs.
- Use WAL for cold semantic indexing with bounded commits, read-only queries,
  one writer/checkpointer and recovery of committed batches after interruption.
- Report semantic phases, record counts and stalled work; Retry checks the model
  activation and attempt before restarting and resumes saved records.
- Synchronize dimension labels with the current camera frame. Keep fixed-distance
  input in a compact dock with selectable mm/m units and signed X/Y/Z axis snaps.

Validation: 160 Python tests, 29 frontend behavior tests and 16 Chromium E2E tests;
real-model cold-index read/resume checks and desktop WebView2 smoke tests. Model
files, caches, benchmark results and executable artifacts are excluded from Git.

## 1.0.1 — 2026-09-02

- Set the application, API, frontend fallback and Windows executable metadata to
  version 1.0.1. Desktop JSON logs now include the application version.
- Reduce avoidable fragment-buffer copies during model loading and cache upload.
- Serialize semantic-index workers, cancel superseded work and resume incomplete
  cold indexes from a usable hot index.
- Move cache retention off activation requests and protect model bundles while
  they are uploading or in use.
- Serialize model activation and discard stale measurement results after tool or
  model changes.
- Include model and operation context in structured logs; invalidate semantic
  caches when the extractor version changes.
- Add lifecycle, buffer-transfer and large-model benchmark tooling. Local IFC
  files, generated measurements, caches and executable artifacts are excluded
  from the source release.

Known limitations: dense steel models can still stutter during navigation.
SQLite cold-index writes can temporarily delay hot-index reads; this release
does not claim to fix that contention. Large-model benchmarks were run against
the source application; packaged smoke checks are recorded locally.
