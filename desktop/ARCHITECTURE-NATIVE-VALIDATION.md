# Architecture native-load regression — 2026-10-06

The reported external `Architecture.ifc` is 679,743,694 bytes and contains
11,205,832 entities. Its header declares IFC2X3. The saved OLED/native EXE
reproduced the reported `Native Rust geometry · 75%` display throughout a
three-minute observation, with no geometry yet published to the viewer.

## Cause and change

The client capped geometry progress at 75% after only 550 meshes and waited
16 ms after every packet. This model emits 10,508 packets: those fixed waits
alone add approximately 168 seconds. The producer remains active, but its
two-packet queue waits for that slow consumer. The viewer publishes the native
scene only after geometry and BIM ingestion complete.

The client now drains ready packets, yields to painting/cancellation after a
work interval, and briefly waits only when the producer has no packet ready.
Rust status publishes processed-element, total-element and emitted-mesh
counts. Progress uses the actual element denominator. Older saved hosts show
received mesh counts with an indeterminate bar instead of an invented 75%.
The final-packet drain and exact emitted-mesh count check remain in place.

The BIM request now selects the canonical server's existing `rootedOnly`
projection. It keeps IFC roots and referenced non-rooted endpoints, with the
property, quantity, relationship, material and hierarchy tables intact. It
avoids sending millions of point/face plumbing rows to the UI. Vertex bounds
validation also avoids allocating a temporary array for every vertex; its
coordinate math and finite checks are unchanged.

## Real-file evidence

The exact previously delivered `10.3.0-oled-native-d40f7e8` EXE was used as
the native host. No application EXE was rebuilt or replaced.

- An isolated geometry-only drain completed successfully: 321,675 meshes in
  10,508 packets, 3,042,160,832 binary bytes, 96,643,034 vertices and
  52,393,036 triangles. Its native processing summary reports completion.
- An isolated rooted BIM request completed successfully with 222,107 entity
  rows, 40,216 property sets and 89,112,158 JSON bytes. Full entity scope would
  include all 11,205,832 rows.
- The current frontend was served locally inside that EXE's existing WebView2
  origin, preserving its native command permissions. The original local IFC
  entered through the actual file input. Loading reached Complete/100%, with
  `loadPath=native`, 321,675 meshes, 222,107 BIM rows and no model load error.
  The captured screenshot visibly shows the stadium model and hierarchy.
- A first remote-origin attempt was rejected by the host ACL. A subsequent
  development run was interrupted by hot updates from verification builds.
  The successful run preserved the packaged origin and disabled file watching;
  neither diagnostic setup failure is counted as a model success.

Local reports and screenshots remain in ignored `desktop/reports/`:
`architecture-native-recheck`, `architecture-geometry-direct`,
`architecture-semantics-rooted` and `architecture-current-frontend`.
The private IFC and its contents are not committed or uploaded.

## Regression checks and limits

- The new ready-packet and real-progress tests failed before the client fix.
  All three native runtime regression tests pass afterward, including final
  packet delivery and rejection/cleanup of incomplete streams.
- Both existing native BIM-table/packet-decoder tests pass. Root Turbo viewer
  typecheck passes. These are focused checks, not a full upstream suite claim.
- All 17 desktop Rust tests and all-target Clippy with warnings denied pass.
  Tests verify progress before processing, under producer backpressure and
  after real fixture completion, including its camelCase wire fields.
  Cancellation still checks actual temporary-file deletion within the original
  deadline; it now also waits for field destruction after the final Arc's
  strong count reaches zero.
- Focused lint, diff whitespace and the module-size ratchet pass without
  suppression or increased budgets.

The successful large-file UI check uses the new frontend with the saved native
host. New Rust progress counters are covered by compiled Rust tests; they have
not been exercised on Architecture in a newly packaged application.

This does not establish web/native geometry parity. The native geometry summary
contains 32 CSG failures across 25 products and six dropped degenerate
triangles. The renderer also warns about IDs beyond its 24-bit seam encoding.
Native currently emits flat meshes rather than the web path's instanced shards,
so this fix does not eliminate the model's large frontend/GPU memory footprint
or provide a persistent native model handle. The saved EXE remains unchanged.
