# Complete library package integration, 2026-10-19

This extends the custom desktop core 10.4 delivery with the complete package
source set from upstream production `61d209288c1b117d405628ead302d0ee700bd2a0`.
It retains Rust 20.4 / WASM 10.4 and the customized viewer 4.0. The later Rust 21.4
migration and the complete upstream web 5.1.5 interface are separate changes.

The Info catalogue now contains 62 real workspace packages, matching all 62
versions observed on the deployed web on 2026-10-19. Previously 25 matched,
31 were older and six were missing. The catalogue includes headless tools and
source providers; it is a workspace catalogue, not a list of modules all bundled
into the desktop executable. Versions were imported with source, dependency
manifests, tests and matching guides, not changed only for display.

New libraries: `ai`, `ids-agent`, `ids-authoring`, `report-contract`, `semantic`,
and `source-autodesk`. Their APIs are available through their package exports
and consuming SDK/CLI paths. New upstream workbench panels are not silently
substituted for the custom interface.

## Custom behavior retained

Native host/geometry transport, Colorizer and persistent Save as, fixed canvas
and panel docking, TestIFC navigation/ViewCube/section controls, cooperative
uploads and BVH picking retain their existing local implementations. The small
viewer adapter change handles new Flow statuses and IDS locales; pending human
review blocks publishing partial Flow writes as a completed layer.

## Windows native BCF storage

Directory flushes open write-capable handles on Windows. Namespace comparisons
handle Windows extended-length paths. Every real sync, exclusive claim,
identity check and conservative recovery guard remains. Only a successful
observation of this process's immutable identity is reused; foreign PIDs are
queried afresh so termination and PID reuse remain observable.

`IFCLITE_BCF_OUTBOX_DIR` must point to a stable directory whose ancestors through
the volume root permit write-capable directory handles and flushing. A default
home directory on an unsupported volume refuses publication before HTTP effects;
it is not silently converted to weaker persistence. Tests use an owned F: root,
and default-path tests set HOME/USERPROFILE only for their owned child processes.

Correctness tests retain all 16 epoch transitions, all 256 generation receipts and
all 130 actual capacity-test server effects. Selected Windows test deadlines
allow the real filesystem and process-identity operations to finish; production
work/byte bounds, server-effect counts and assertions are unchanged. Windows
symbolic-entry refusal uses a genuine directory junction without requiring
optional file-symlink privileges.

## Qualification

The root package build passed all 62 package tasks. Package correctness coverage
is composite: 59 successful complete package suites, the successful complete
MCP suite (735 passed, 5 existing conditional skips), the complete Flow suite
(248 passed, 16 existing conditional skips), and CLI's full 1,487-test run plus
focused retakes resolving its six failures (1,471 unique passing tests,
16 existing conditional skips). The final exact-process retake filters the
seven cases already passed; it adds no source skip. This is not presented as a
single green run of all 62 suites.

Root `pnpm typecheck` passed 120/120 tasks and covered all 3,597 test files.
The selected custom viewer integration suite passed 294/294 with no skips.
The exact delivered EXE passed 15/15 acceptance groups with a real hangar IFC
(1,681,800 triangles), including the displayed 62-package Info catalogue,
panel/docking gestures, federation and Colorizer Save as (11,873,913 bytes).
There were no page runtime errors in that audit. Generated API/ambient types,
474 documentation snippets, templates, README coverage, module-size ratchets
and source-assertion checks passed. Targeted lint passed. The aggregate lint
wrapper's previously recorded Windows pnpm shim issue was not requalified.

Qualification is recorded in the separate release's `provenance.json` and
reports. No new large-model performance, full external fixture corpus, real cloud
account or universal geometry-parity claim follows from this package upgrade.
The previously deferred extended Box gesture sweep is not reclassified as passed.
The unchanged WASM SHA256 is
`06b5b05d47c7ca8744fb04da240c7c00390b11b7187e454d1f33e0daa8b106d6`.

The implementation lives in `F:/Steel/VBA/IFC-Lite-Core104`, branch
`codex/packages-full-10.4.0`. The original checkout, 240 protected source hashes,
input IFC and previous r3 executable remain intact. No push, Actions or deployment.

## Complete catalogue

| Package | Previous | Integrated / observed web |
| --- | --- | --- |
| @ifc-lite/ai | absent | 0.2.0 |
| @ifc-lite/bcf | 5.0.0 | 5.0.1 |
| @ifc-lite/bcf-api | 0.2.4 | 0.3.0 |
| @ifc-lite/cache | 3.7.0 | 3.7.2 |
| @ifc-lite/charts | 0.8.0 | 0.9.0 |
| @ifc-lite/clash | 2.4.4 | 2.4.4 |
| @ifc-lite/cli | 0.38.2 | 0.41.0 |
| @ifc-lite/codegen | 1.18.1 | 1.18.1 |
| @ifc-lite/collab | 0.10.0 | 0.10.0 |
| @ifc-lite/collab-server | 0.8.1 | 0.9.0 |
| @ifc-lite/create | 4.0.0 | 5.1.0 |
| @ifc-lite/data | 6.2.0 | 6.2.0 |
| @ifc-lite/diff | 0.10.0 | 0.10.0 |
| @ifc-lite/documents-api | 0.2.0 | 0.2.1 |
| @ifc-lite/drawing-2d | 4.1.0 | 4.2.0 |
| @ifc-lite/embed-protocol | 1.15.0 | 1.15.0 |
| @ifc-lite/embed-sdk | 1.15.0 | 1.15.1 |
| @ifc-lite/encoding | 2.3.0 | 2.3.0 |
| @ifc-lite/export | 4.11.0 | 4.11.0 |
| @ifc-lite/extensions | 0.10.1 | 0.11.0 |
| @ifc-lite/flow | 0.5.0 | 0.7.0 |
| @ifc-lite/flow-nodes | 0.6.0 | 0.10.0 |
| @ifc-lite/geometry | 7.8.1 | 7.8.1 |
| @ifc-lite/ids | 3.2.0 | 3.3.6 |
| @ifc-lite/ids-agent | absent | 0.2.6 |
| @ifc-lite/ids-authoring | absent | 0.2.6 |
| @ifc-lite/ifcx | 4.4.0 | 4.4.0 |
| @ifc-lite/lens | 2.1.0 | 2.2.0 |
| @ifc-lite/lists | 3.0.1 | 3.1.7 |
| @ifc-lite/load-trace | 0.3.0 | 0.3.0 |
| @ifc-lite/mcp | 0.23.0 | 0.27.0 |
| @ifc-lite/merge | 0.4.7 | 0.4.7 |
| @ifc-lite/mutations | 3.2.0 | 3.2.0 |
| @ifc-lite/oauth-pkce | 0.2.0 | 0.3.0 |
| @ifc-lite/opencde-foundation | 0.2.0 | 0.3.0 |
| @ifc-lite/parser | 9.5.1 | 9.5.1 |
| @ifc-lite/plugin-api | 0.4.0 | 0.5.0 |
| @ifc-lite/pointcloud | 0.12.0 | 0.12.0 |
| @ifc-lite/provenance | 0.2.0 | 0.2.0 |
| @ifc-lite/query | 2.5.2 | 2.5.2 |
| @ifc-lite/regex-guard | 0.3.0 | 0.3.0 |
| @ifc-lite/renderer | 6.4.0 | 6.4.0 |
| @ifc-lite/report-contract | absent | 0.1.0 |
| @ifc-lite/rules | 0.6.0 | 0.7.7 |
| @ifc-lite/sandbox | 2.10.0 | 2.12.0 |
| @ifc-lite/sdk | 9.0.0 | 9.5.0 |
| @ifc-lite/semantic | absent | 0.2.1 |
| @ifc-lite/server-bin | 2.0.0 | 2.0.1 |
| @ifc-lite/server-client | 4.0.0 | 4.0.1 |
| @ifc-lite/solar | 1.15.5 | 1.15.5 |
| @ifc-lite/source-autodesk | absent | 0.2.1 |
| @ifc-lite/source-dalux | 0.4.0 | 0.4.1 |
| @ifc-lite/source-dropbox | 0.3.0 | 0.4.0 |
| @ifc-lite/source-fixture | 0.3.0 | 0.3.1 |
| @ifc-lite/source-msgraph | 0.3.0 | 0.4.0 |
| @ifc-lite/spatial | 1.15.0 | 1.15.0 |
| @ifc-lite/timing-ladder | 0.1.0 | 0.1.0 |
| @ifc-lite/viewer-core | 0.2.25 | 0.2.26 |
| @ifc-lite/wasm | 10.4.0 | 10.4.0 |
| @ifc-lite/wasm-lifecycle | 0.2.0 | 0.2.0 |
| @ifc-lite/world-frame-fixtures | 0.1.4 | 0.1.4 |
| create-ifc-lite | 1.15.0 | 1.15.1 |
