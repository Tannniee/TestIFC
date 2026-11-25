# Native Rust desktop checkpoint — 2026-10-03

Checkout: `F:\Steel\VBA\IFC-Lite`, `codex/desktop-v10.3.0`.
Upstream source is `v10.3.0` (`e79f27342…`); its Rust workspace is 20.3.0.
Dependencies use those local crate paths. Native is a migration preview,
separate from the saved UI EXE/installer in `release/10.3.0-ui-0756f24/`.

## Implemented

- Tauri job commands receive STEP IFC in binary chunks of at most 2 MiB,
  or snapshot a disk path. Source is owned by Rust; the viewer enters this
  route before whole-file acquisition.
- A background worker invokes the canonical processing pipeline with Rayon,
  RTC, opening cuts, materials and cooperative geometry cancellation. It
  does not retain a second complete mesh collection.
- Packet v1 uses binary numeric pools and JSON descriptors. Tauri Response
  returns ArrayBuffer; a pull consumer drains a two-packet bounded channel.
  This bounds queue depth, not RSS: packet size still depends on mesh size.
- The canonical published basis restores world axes from native site-local
  rotation, then the existing server axis conversion emits [x,z,-y]. Per-mesh
  f64 origins remain separate. IFC RTC provenance is retained for overlays.
- Properties/Pset/Qto, relations, classifications, materials and hierarchy use
  the exact server semantic extractor, compiled by path without HTTP/Arrow.
  The existing server-store adapter hydrates the viewer's BIM tables.
- Primary/federated sources still enter `useIfcLoader.loadFile` and its one
  finalizer. Native errors surface without silently retrying with WASM.
- `npm run build:native-preview` enables native STEP by default, uses a distinct
  window title and produces a standalone EXE without an installer. Ordinary
  builds retain WASM as default; `?engine=native` selects native for validation.
  Ordinary web builds never install the desktop runtime.

## Verified

Windows x64, Rust stable 1.99, packaged WebView2 and actual WebGPU:

- 9 Rust library tests and 3 integration tests passed. Fixture transport is
  compared against the existing canonical geometry export: every world vertex
  in both directions and bounds at 0.2 mm tolerance, plus render counts.
  The export welds duplicate render vertices, so ordered raw vertex counts
  alone are not treated as proof of world placement.
- A fixture with a rotated IfcSite passed the same world-vertex/bounds checks
  and retains the canonical site's camera rotation metadata.
- Separate packaged WASM and native snapshots of building-architecture.ifc
  passed `compare-engine-snapshots.mjs`: bidirectional world vertices, triangle
  surfaces and winding, material colors and geometry classes. The largest
  vertex delta was 0.000000954 m across 14 meshes/1,170 triangles. This proves
  parity on that public fixture, not general IFC geometry coverage.
- Real meshing of repeated fixture geometry stalls at the bounded channel;
  cancellation releases its worker and owned temporary snapshot. Isolated
  jobs, malformed input, late source mutation and duplicate starts are checked.
  The repetition is a lifetime stress fixture, not an authoring-tool benchmark.
- The processing crate's x64 wide-offset test passed after simulated u32::MAX.
  It does not prove an actual IFC file over 4 GiB was opened.
- Root Turbo viewer typecheck passed, including desktop client/decoder through
  the new test import. Focused tests passed: native table conversion and packet
  rejection, prewarm behavior and load reports.
- Desktop `cargo +stable clippy --all-targets -- -D warnings` passed. The UI bin
  has Cargo test=false; its synthetic clippy test harness excludes the UI entry.
  Production host code is still checked. Backend library tests and packaged
  WebView2 cover the actual native commands/semantic path.
- Packaged native smoke opened architecture/revision IFC: 14 meshes each,
  444/474 semantic rows, resolved Pset_SlabCommon, Hierarchy, six views, cube
  roll/drag/corners/edges and section box. Backend reported 64-bit pointers.
  Both models reported loadPath=native, zero source bytes in their datastores
  and zero WASM instantiations on this native route. This is actual IPC/runtime
  evidence, not a mocked bridge result.
- The enabled preview launches native without a URL override. Primary and
  second-model loads clear the global loading overlay after alignment; this
  caught and fixed a native federated-load completion regression. The actual
  Properties component displays Pset_SlabCommon for the selected native slab
  through public selection actions, without needing frontend source bytes.
- Module-size ratchet passed without raised budgets. A trailing blank line in
  useMouseControls was removed to restore its pre-existing one-line overrun;
  native orchestration was extracted into a small module.

Reports remain in ignored `desktop/reports/`. The full upstream viewer suite's
previously documented tooling failures remain; no full-suite green is claimed.

## Remaining

This preview does not replace every WASM consumer. Source-less stores need
native attributes/queries for the complete editing/export surface. Native IFC
export with mutations, fingerprints/diff, analytic/symbolic queries, texture and
IFCZIP parity, persistent disk cache, and large-file qualification remain.
Import jobs close after ingestion; persistent native model handles and their
attribute/query APIs are the next migration slice, with cleanup on model removal.
Other formats retain existing paths. Semantic tables are hydrated in full,
so WebView memory can still be substantial. Geometry is transported progressively,
but this first adapter presents the model after semantics finish.

Native removes WASM32 linear memory from the implemented STEP load path. The
worker reads a native Vec and semantic extraction allocates working data, so RAM
still matters. No actual IFC >4 GiB, large-model RSS/GPU budget, cold-load speed
improvement, large-corpus geometry coverage or survey-grade GIS alignment is
claimed. The public federation fixture keeps its EPSG:32760 reprojection warning.
Keep the saved UI baseline as the normal app while preview qualification continues.

API rationale: [IFC-Lite desktop guide](https://ifclite.dev/docs/guide/desktop/)
and [Tauri binary responses](https://v2.tauri.app/develop/calling-rust/#returning-array-buffers).
Payloads are pinned by local source and packaged runtime tests.
