# Custom desktop core 10.4 qualification

This is the customized Windows host, not an upstream desktop distribution.
The integration uses upstream production commit
[`61d209288c1b117d405628ead302d0ee700bd2a0`](https://github.com/LTplus-AG/ifc-lite/tree/61d209288c1b117d405628ead302d0ee700bd2a0).
The newer, breaking Rust major on `main` is outside this upgrade.

| Component | Before | Integrated |
| --- | --- | --- |
| Custom viewer UI | 4.0.0 | 4.0.0 |
| Custom desktop host | 10.3.0 | 10.4.0 |
| Rust workspace | 20.3.0 | 20.4.0 |
| WASM | 10.3.0 | 10.4.0, built from the matching Rust source |
| Parser | 9.2.0 | 9.5.1 |
| Geometry | 7.7.0 | 7.8.1 |
| Renderer | 6.0.1 | 6.4.0 |
| Data | 6.1.0 | 6.2.0 |
| Spatial | 1.15.0 | 1.15.0 |
| TypeScript export | 4.9.0 | 4.11.0 |

The footer's 4.0.0 is the custom viewer version. It does not describe the Rust
or WASM engine. Backend diagnostics now derive the engine version from
`[workspace.package].version` at build time; the former hardcoded 20.3.0 is gone.

## Source and preservation

The implementation is isolated at `F:/Steel/VBA/IFC-Lite-Core104`, branch
`codex/core-10.4.0-upgrade`. The original checkout and its uncommitted source
remain at `F:/Steel/VBA/IFC-Lite`, branch `codex/desktop-v10.3.0`.

- `0074241838dd52f456ac88c274700c09a9754cc6`: frozen custom source snapshot.
- `142de48a`: canonical Rust engine, server consumers and platform qualification.
- `95dbbc37`: TypeScript runtime closure, WASM types and worker build contracts.
- `b54d6ff7`: native host version metadata, tools, documentation and evidence.

The runtime closure contains fifteen workspace packages. The viewer keeps its
custom panels, themes, stationary canvas, Colorizer, TestIFC navigation/cube/
section tools, federation/GIS integration, cooperative uploads, native instancing
and bounded CPU picking. The viewer adapter changes quantity/history replay to
the new canonical mutation helper; upstream viewer UI features were not imported.

The source audit rechecked 240 original application file hashes and the prior
quality-audit EXE hash. All matched. Existing releases were retained. Nothing
was pushed, published, deployed or submitted to GitHub Actions.

## Verification

The complete logs and IFC downloads are retained locally under
`research/core-upgrade-20261017/`.

- Root Rust workspace: 4,796 passed, zero failed, 41 explicitly ignored.
- Root viewer suite: 13,794 passed, zero failed, 25 conditional skips, twelve
  shards. The root viewer build completed before the root Turbo test shards.
- All 57 remaining package test tasks passed across the complete run and the
  focused rechecks. The Windows corrections retain behavior assertions and
  introduce no new skipped cases.
- Root typecheck: 111 tasks passed; all 3,346 test files across 57 packages are
  included in a typecheck program.
- Actual source-built WASM contracts: 193 passed, zero failed, seven optional
  fixture skips. The runtime hash stayed unchanged through subsequent builds.
- Root Rust clippy passed with warnings denied. All 33 desktop tests passed;
  the Python consumer's four tests passed and the separate benchmark consumer
  compiled. This does not establish a packaged Python wheel ABI test.
- Documentation: 437 snippets compiled across 102 documents; twelve explicitly
  illustrative snippets remain skipped. Documentation tool regressions: 26/26.
  Updated version/material parity guard regressions: 98/98.
- TypeScript and Rust API snapshots match. Existing TypeScript exports remain
  available. Module-size checks added no allowlist row or raised budget;
  source-text assertions, WASM disposal and reference-walk guards passed.

Windows fixture edits now account for CRLF. Byte-exact generated cross-language
fixtures and EXPRESS inputs retain LF on checkout. Native Windows geometry and
symbolic references were checked against the unchanged 20.3 executable output;
the shared non-MSVC references remain intact. The server also distinguishes a
cache root replaced by a file from a genuine miss on Windows.

`pnpm lint` is not green locally: its first changeset guard invokes the Windows
`pnpm` shim through `execFileSync` and fails with `ENOENT` before the later gates
run. This predates the upgrade. Targeted integration lint and the separate
checks above do not imply that the aggregate lint command passed.

## Packaged behavior

The final candidate and its exact source/artifact hashes are recorded in the
release folder's `provenance.json`. Its build uses the native frontend flag and
the desktop stable Rust toolchain. Packaged evidence names the EXE it exercised.

The real hangar qualification covers empty and loaded panels, rapid switching,
Drawing without replacing the 3D canvas, real mouse input, opaque panel pixels
in three themes, Colorizer lifetime/undo, federation ownership, selection,
export during a panel switch and clearing models. The extended native gate
also checks the backend version, zero WASM initialization, source bytes kept
outside WebView2, section handles/cancellation/cut pixels, navigation, cube
views and native Properties.

The interaction audit exercises 53 assertions, including right-click quick
colour on five actual picked objects, shared undo, export and native reopening.
Independent IfcOpenShell readback checks every painted Body item, unchanged
non-presentation records and world-space geometry samples. Independent pixel
readback checks that camera motion changes no pixel in covered panel regions.

Earlier native smoke helpers assumed an expanded, resizing ribbon and automatic
selection reframing. They now operate the actual ribbon controls, expose the
canvas before rectangle gestures, sample rendered geometry for picking and
assert the existing stationary-view contract. Camera cancellation waits for its
real transition before comparing the exact restored pose.

Large-model qualification is recorded in the local `r2-svd` and
`r2-pvf-diagnostic` reports. Both passed native loading, actual orbit/pan/zoom,
model-owned selection, clearing and an ordinary window close with exit code
zero. These are functional checks, not a frame-time benchmark. The earlier
`r2-pvf` run lost its page connection during loading; its evidence is retained,
and the subsequent instrumented isolated run passed without application changes.

## Final local delivery and follow-up boundary

The final executable is
[`10.4.0-native-core-20261017-r3/IFC-Lite.exe`](../../IFC-Lite/desktop/release/10.4.0-native-core-20261017-r3/IFC-Lite.exe).
Its SHA-256 is
`b35d3d085edf89c776e3316d0e0e69b7f20915da72e264259a08a093865b789b`.
It was built with stable Rust from tracked-clean native source at `b54d6ff7`.
The embedded native frontend was built before that commit, at `95dbbc37` with
the host integration still uncommitted; its application inputs were retained
through `b54d6ff7`. Release `source-inputs.json` records the source and embedded
asset hashes, and `provenance.json` records the exact build boundary.

On this exact r3 EXE, all fourteen packaged quality groups passed with zero
page errors. Its actual window title is `IFC-Lite 10.4.0 — Native Preview` and
backend diagnostics report Rust 20.4.0. The native title is the only runtime
change from the already qualified r2 executable; its content now follows the
host package version rather than a stale 10.3.0 literal.

The r2 executable passed all 29 extended native smoke cases, 53 interaction
assertions, both independent IFC colour readbacks and the large-model runs
above. Do not describe these as complete r3 reruns. The additional r3 native
smoke stopped at the first Box sweep (`sectionPlane.enabled` remained false).
The failure image shows a remembered drawing session and a bottom dock covering
the stationary canvas. That is evidence for follow-up, not a confirmed root
cause or a final r3 Box pass. An attempted harness adjustment was cancelled
before qualification and was not retained in source.

The user explicitly requested no further testing and completion of the handoff.
The pending extended r3 smoke, interaction and large-model reruns were stopped;
no extra checks were launched afterward. Logs, the original failure image and
earlier successful runs remain under `research/core-upgrade-20261017/`.

## Performance scope and limits

Interleaved native base-versus-branch probes used the same absolute house and
void-heavy ISSUE_129 inputs, stable compiler and profiling settings. Ordered mesh
payload fingerprints and counts matched. No slowdown appeared in that bounded
cohort. Raw generated measurements and their environment are committed under
[`scripts/perf/evidence/core-upgrade-104`](../scripts/perf/evidence/core-upgrade-104/).
The verdict and lesson are in the performance ledger; no CI baseline was repinned.

This does not claim a browser worker-pool speedup, removal of all navigation
stalls or geometry parity for every IFC. The fixture catalogue was partial;
fixture-dependent tests retain their documented skip behavior. Full CRS
alignment is not certified: the synthetic federation smoke shows the same
EPSG:32760 warning on both the previous and upgraded executable. Cloud login,
external texture portability and a Python wheel runtime were outside this run.
