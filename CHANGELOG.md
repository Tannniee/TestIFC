# Changelog

## 1.0.4 — 2026-09-25

- Expand Engine V2 profile and face coverage: accept rounded DEGREE conversion
  factors, filleted hollow rectangles, C and L profiles, reversed trimmed arcs,
  slightly rounded polygonal coordinates, auxiliary CoG points, generic
  IfcProductRepresentation bindings, empty shape representations, collapsed
  zero-area PolyLoops, and translated folded strips.
- Add resumable graph and artifact corpus gates for the local IFC test corpus.
  The full 34-file `IFC Temp` corpus now produces viewer-ready Engine V2
  artifacts. Boolean trees and malformed source surfaces use selective,
  source-hash-bound IfcOpenShell meshes inside the native artifact pipeline.
- Recover exact zero-area outer/hole matches, exact backtracking ring spurs,
  redundant nested holes, and tilted congruent holes in bounded faces. The
  Bison and Kingston reference files now produce viewer-ready artifacts.
- Build an isolated 1.0.4 EXE and verify cold packaged WebView2 loads:
  `MaiSanh_F02_26-08-03.ifc` in 1.14 s and the 255 MB Bison reference file in
  26.87 s, including native semantic readiness. These timings are single runs.
- Route every accepted IFC through Engine V2, including small browser files and
  models up to the 2,000,000,000-byte limit. Remove WebIFC and Fragments runtime
  assets from the frontend package.
- Stream native artifacts into the Three.js viewer and retain transactional
  loading, cancellation, selection, model switching and semantic lookup.
- Resolve nested Boolean, solid-operand CSG, invalid BRep and polygonal faces,
  problematic extrusions, swept disks, and revolved solids through selective
  IfcOpenShell conversion. An empty Boolean result emits no product geometry.
  Keep the previous model visible if a new one cannot be built.
- Run selective IfcOpenShell repair in a child process so its expanded IFC graph
  is released after conversion instead of remaining in the desktop process.
- Record separate artifact and visible-load metrics for the large-model path.
  Very large CSG models can still take several minutes on a cold conversion.
- Support derived 2D profiles and topologically matched tapered extrusions in
  the native worker; recognize unstyled material layer sets without rejecting
  the model. Verified on `TTHC-IFC.ifc` and `MaiSanh_F02_26-08-03.ifc`.
- Cache generated base mesh clusters within a 64 MiB planner budget for repeated
  pages. A lightweight product-bounds overview now keeps all `GIAN NANG.ifc`
  groups visible while exact triangles stream into the page residency budget.
- Colour the bounded overview from each product's first material, hide it for
  hidden products, and dim it where exact pages are resident. Extend overview
  capacity to the 620,315-product SVD reference model.
- Admit up to 96 visible pages when their aggregate geometry is small enough;
  this restores the complete 66-page TTHC overview within the existing GPU
  and triangle budgets.
- Decode Engine V2's stored RGB colours into Three.js's linear working space
  before uploading instance colours. Match the 1.0.3 WebIFC palette on
  `MaiSanh_F02_26-08-03.ifc` without changing model transparency.

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
