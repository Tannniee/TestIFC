# PVF native desktop crash investigation — 2026-10-07 / 2026-10-09

Checkout: `F:\Steel\VBA\IFC-Lite`, `codex/desktop-v10.3.0`.
Private test source: `IFC_PVF.ifc`, 1,411,171,948 bytes. The source and
diagnostic outputs remain outside tracked artifacts.

## Reproduced failure

Windows Application events identified the delivered
`release/10.3.0-native-72420ce/IFC-Lite-10.3.0.exe` twice with exception
`0xe0000008`. A fresh-profile run of that exact EXE reproduced host exit
3758096392 at **Native BIM properties and hierarchy**, after geometry completed.
This is Chromium's Windows out-of-memory exception, not evidence of a WASM
4 GiB failure or invalid IFC syntax.

The native geometry pass considered 760,126 elements. Before BIM extraction,
the WebView retained approximately 8.54 GB of binary backing storage. During
BIM extraction, the native host's sampled private commit reached approximately
14.84 GB. The old adapter decoded metadata for every STEP instance before
discarding non-rooted rows, copied the whole source for parallel extraction,
then built a model-sized `serde_json::Value` and one complete IPC JSON response.

## Changes

- The canonical server extractor accepts an early rooted scope. Geometry
  plumbing is excluded before metadata decoding. Referenced non-rooted
  relation/material endpoints are recovered in file order, using the same
  metadata extractor. Unknown types keep the existing GlobalId fallback.
- Parallel extractors borrow the original source instead of copying it.
- Desktop semantics serialize record by record to an owned temporary file.
  The client pulls binary chunks of at most 2 MiB and parses only complete
  records, including split UTF-8. The old monolithic IPC command is removed.
- Completion requires both the declared byte length and an end marker.
  Cancellation closes the job and deletes its semantic stream; a late
  preparation cannot publish a cancelled job.
- The producer computes exact viewer bounds from each transmitted vertex and
  f64 origin. The client validates this small summary instead of rescanning
  all resident geometry on the UI thread after BIM hydration.
- The semantic reader builds entity columns and lookup maps as records arrive,
  avoiding a second bulk conversion and retained metadata row objects.
  Repeated property/quantity labels, measure tags and relationship type strings
  share their storage. Color updates are discarded after application.
- Native conversion releases each raw relationship record after ingesting its
  edge. The canonical graph still preserves deduplicated relationship ids and
  shadowed ids. Entity lookup retains its index rather than the full raw DTO.
- Native primary/federated registration commits geometry while renderer
  streaming mode is active. The existing bounded mesh queue drains and
  finalizes it, rather than merging the whole snapshot inside a React effect.
- The native adapter stamps mesh ownership once. Viewport ownership stamping
  shares correctly stamped meshes and copies only owners that actually change.

## Checks

- 78 canonical BIM tests pass, including equality of every scoped table and
  referenced endpoint against the previous full-extract-then-filter result.
- Desktop Rust tests cover geometry/world-coordinate parity, stream byte
  bounds, record reconstruction, cancellation and cleanup.
- Relevant viewer test shards: 22 tests pass, including UTF-8 boundaries,
  incomplete semantic EOF, packet draining, Pset/Qto and spatial containment.
  Real React effects also verify that primary and federated native geometry
  commits enter queued upload mode before the completion flag changes.
  Ownership tests verify sharing and copy-on-write without changing source ids.
- Another 69 existing server-conversion tests pass, covering traversal,
  relationship ids, Properties/Qto and material semantics. The native test
  explicitly checks that releasing raw rows preserves a duplicate's shadow id.
- Root typecheck completes all 109 tasks and audits all 3,247 test files.
- Desktop clippy and focused TypeScript lint pass; module-size budgets were
  not raised. Workspace clippy is blocked by three existing Rust core warnings
  in `georef.rs`, `parser/lexical.rs` and `parser/scanner_attributes.rs`.

## Real-file verification

The first internal candidate passed the old host-crash point, received all BIM
records and released native working memory to approximately 200 MB. The
Playwright diagnostic stopped returning fresh samples at 95%; that alone did
not prove the application had hung. Observation was stopped manually, so that
run is not a verified full-model open. A later candidate reached source
identification/registration; an early-enabled debugger captured
the main thread in `Scene.appendToBatches` and batch-origin selection during
React's geometry effect. That upload was synchronous because the native
adapter published a finished snapshot without entering renderer streaming mode.
The queued-upload candidate's last diagnostic sample was source identification;
it was also stopped without verified completion. A claim that its renderer had
exited was unsupported: mixed PowerShell table output had hidden process fields.
During the current candidate, the same diagnostic stalled at source ingress,
while a direct CDP `Runtime.evaluate` proved that the application was actually
processing geometry and receiving BIM records. Verification now uses direct,
unwrapped CDP calls, live renderer console events and process-id queries.
The final internal candidate was checked in packaged WebView2 with its embedded
frontend and native STEP default, using a fresh profile and direct CDP. It
received all BIM records, built the viewer indexes and displayed the actual PVF
model. Its datastore contained 2,589,544 entities and 1,531,220 meshes, with
245,093,805 vertices and 148,025,417 triangles. Source bytes in the UI were zero.
The sampled mesh entity 126 had three property sets and sixteen properties.
The screenshot `reports/pvf-disposable-progress.png` shows the visible model
and file information panel. Selecting that entity in the Properties UI was
scheduled after renderer finalization, so that UI check is still outstanding.

The user requested a summary and stop. The final live sample was at
1,383,633 ms (about 23 minutes); the application had not spontaneously exited,
but no `finalizeStreamingAsync complete` event had been observed. The owned
test application and its WebView children were terminated deliberately at the
user's request. `reports/pvf-disposable-user-stop.json` records this separately;
the subsequent host exit is a manual test termination, not another crash.
This proves passage through the original crash point and actual visible native
rendering, not a fully finalized large-model open. Loading remains slow.

The same internal build passed the packaged small-model smoke, including
selection, native default, views/cube, section box and federation. The existing
EPSG:32760 fixture alignment warning remains and is not PVF placement evidence.
The previously delivered EXE is preserved.

## October 7 stop checkpoint

- Current branch: `codex/desktop-v10.3.0`, HEAD `471284f`. That commit contains
  the early rooted server extraction. The remaining desktop/renderer-adapter
  changes and this report are uncommitted; do not reset or discard them.
- Internal test executable: `src-tauri/target/release/ifc-lite-desktop.exe`,
  built on 2026-10-07 at 16:38:47 local time. The saved release under
  `release/10.3.0-native-72420ce/` has not been replaced.
- Ignored evidence: `reports/pvf-disposable.json`, console/host/probe logs,
  progress screenshot, user-stop record, and `pvf-disposable-small-smoke.log`.
- Next: investigate the long geometry queue/draining stage, then rerun the
  actual PVF through renderer finalization and verify selected Properties,
  camera interaction and clean close. The raw-only launcher is
  `reports/pvf-launch-raw.mjs`; increase its observation window before rerunning.
  Avoid HeapProfiler/Debugger and Playwright utility wrappers in this large-file
  run; earlier diagnostic calls stalled without proving an application hang.
- No further build, test, merge or push was performed after the stop request.

Geometry remains flat and resident in the UI. This change removes the BIM
allocation/IPC spikes; it does not establish unlimited memory, geometry parity
for this private model, or a general large-model performance guarantee.

## October 9 resumed investigation

The user reports successful, fast opening at https://www.ifclite.com/. No
official-web PVF timing was supplied or independently collected, so the
following measurements are native candidates, not a timed web/native comparison.

Release-mode headless probes use the same canonical Rust geometry processor on
the actual PVF source, with OS file cache warm and no application IPC, BIM
hydration or GPU upload. Flat geometry finished in 17,690 ms. A bounded 65,536
mesh collation window finished in 17,382 ms, including 2,104 ms of verified
collation: 1,370,547 occurrences in 14,009 templates and 160,673 flat meshes.
All probes retained the source geometry totals, with zero collation rejections
or dropped placeholders. A separate 8,192-window Low tessellation probe had
exactly the same geometry counts as Medium; reducing tessellation was not made
a production workaround. These timings do not establish application open time.

The native transport now uses the existing canonical collator and IFNS encoder
for eligible opaque meshes; excluded types, textured meshes, transparent meshes
and rejected/small groups retain flat IFCD rendering. It restores the canonical
site basis before encoding and carries exact per-entity Y-up bounds separately.
Geometry and instance IPC messages target 8 MiB, while the producer retains only
a bounded processing window and the existing two-packet queue. An individual
oversized mesh remains intact. No new mesher, geometry simplification or file
size cap was introduced.

The first instanced packaged candidate (1,024 mesh window) fully finalized PVF
at 539,477 ms (about 9 minutes). It rendered the model and showed selected
instanced entity 1608 with two property sets and nineteen properties. Native
registration finished at 136,580 ms, but synchronous IFNS upload blocked the UI
for roughly three more minutes. Flat consolidation subsequently took 82,298 ms.
This run proves full renderer completion and actual Properties UI; its close
command was rejected by Tauri permissions and the owned test process was then
terminated manually. That termination was not another spontaneous crash.

The next candidate increases the verified collation window, keeps IPC
messages bounded, and yields between IFNS uploads. It records uploaded buffers
so an interrupted React effect can resume without duplicating instances, and
waits for both flat queues and instanced uploads before finalization. The
native/server entity index now uses canonical uppercase source class buckets;
the former PascalCase buckets caused a false zero-element count in the UI.

Focused checks include world transformed vertex/normal/index/color/item-ID
parity and exact bounds, rotated site plus RTC parity against canonical export,
ineligible-mesh preservation, 8 MiB packet subdivision, complete instance
cardinality, partial-stream rejection, upload cancellation/resume, and uppercase
class lookup. Desktop Rust's 25 tests and clippy pass; geometry's 586 tests pass.
Root typecheck passes all 109 tasks, and the test audit covers 3,249 files.
Relevant viewer shards pass, including real React geometry-streaming effects.
The public geometry color-update helper has a patch changeset and its API
surface snapshot is updated. Module-size limits and lint suppressions were not
relaxed.

### Latest actual PVF packaged run

Internal EXE: `src-tauri/target/release/ifc-lite-desktop.exe`, built October 9
at 09:32:13 local time, 42,290,688 bytes. Evidence prefix:
`reports/pvf-native-final-20261009`. Fresh WebView profile; no application model
cache. OS file cache was warm from the preceding engine probes. Lightweight
CDP checks inspect store state and visible UI; one 10-second CPU sample was
collected during the upload stage. This is a single measured run.

- Native result received by 110,983 ms: 160,673 flat meshes, 42 IFNS packets
  totaling 212,340,264 bytes, 14,009 wire templates and 1,370,547 occurrences.
  Flat plus occurrences equals all 1,531,220 source meshes. Vertex and triangle
  totals remain 245,093,805 and 148,025,417.
- Scene registration observed at 121,697 ms. The store's loading flag at that
  point is not renderer completion. Main-thread probes subsequently timed out
  three times; despite yielding between IFNS packets, a roughly 150-second
  response gap remains. The first succeeding sample was at 274,436 ms.
- Renderer completion observed at **401,482 ms**, about **6 min 41 sec**,
  compared with 539,477 ms for the preceding instanced candidate (about 26%
  shorter in these individual runs). Consolidation took 66,054 ms and ended
  with 2,376 flat batches, 18.1 million flat triangles and no queued meshes.
- The screenshot shows the actual stadium and a nonzero **756,457 elements**
  count. Selected instanced entity 1608 displays Default and Tekla Bolt: two
  property sets, nineteen properties, five relationships. Delayed Frame
  Selection successfully zoomed to it; camera rotation changed the viewpoint.
- The harness sent an ordinary window-close request to its own verified EXE.
  Host exited **0**, `cleanClose: true`, with no forced termination or failure.
- Renderer diagnostics after finalization reported 862,134,488 retained GPU
  buffer bytes and 941,967,564 CPU geometry bytes. These exclude BIM/JS heap,
  browser/driver overhead and transient allocations, and are not process peaks.
  A process sample during loading recorded approximately 11.2 GB renderer
  private commit and 5.9 GB GPU-process private commit, so large memory use
  remains. In the 10-second CPU sample, 791 of 1,005 samples were attributed to
  garbage collection, with flat merging/quantization also present. This sample
  does not prove a leak or explain the preceding unsampled response gap.

The new internal build also passes the packaged small-model native smoke:
native x64 default, zero WASM instantiations for STEP loading, zero source bytes
in the viewer, selection/Properties, cube/views, section box and federation.
The existing small fixture EPSG alignment warning remains; this does not prove
PVF CRS correctness. Full private-model geometry/material/unit parity against
the official web viewer was not established. The 24-bit seam-ID warning remains
for this model's ids over 16,777,215; it was not suppressed. No geometry was
dropped to lower counts or load time.

This run resolves the reproduced crash and demonstrates full native opening,
but does not establish web-level performance or unlimited memory. Remaining
work is the main-thread allocation/GC gap, flat upload and consolidation, and
earlier first-visible geometry. The user-reported web speed has no comparable
measured timing yet. The saved delivered EXE under
`release/10.3.0-native-72420ce/` is unchanged; SHA-256 remains
`33C75969596C8C772E65206B4BB0CEA650CF53471C85BC9C935904DBF2AEBEB0`.
No merge or push was performed.
