# Native-axis view cube and smooth orbit validation

Date: 2026-10-03. Base: upstream `v10.3.0` at
`e79f27342beb01a6f30d9b63c44795ecd118f4de`.
Source checkout: `F:\Steel\VBA\IFC-Lite`, branch `codex/desktop-v10.3.0`.

## Behavior

The beveled cube and vertical Home/six-view buttons are adapted from the local
TestIFC UI. Their directions use IFC-Lite's renderer frame: +Y top, +Z front,
+X right. Imported IFC data and IFC-Lite's original axis helper retain their
existing IFC display convention (Z up). No TestIFC coordinate conversion is
applied to the camera. Named views use native preset callbacks, including
building rotation and repeated Top/Bottom rotation. Home uses the native fit.
Edges/corners keep target, distance and projection. Full camera pose drives the
cube, including roll; transform updates are coalesced without React rendering
every camera frame. Theme colors come from IFC-Lite's own CSS variables.

Pointer orbit uses the added `Camera.orbitSmoothed(dx, dy)` method for mouse,
cube and single-finger touch. Displacement is accumulated and spent by
`Camera.update(deltaMs)` with 60 ms exponential damping. Native orbit arithmetic
still determines axes, poles and external pivots. Total input displacement is
conserved; this is a short settling tail rather than additional fling velocity.
Existing `orbit()` stays immediate, including Walk and SpaceMouse. Pose restores,
Home/presets, model resets, pan and restricted interaction cancel pending orbit.

## Checks performed

- Root Turbo viewer typecheck: 49/49 tasks passed after the smoothing change.
- Desktop production build and NSIS x64 installer succeeded. The upstream
  top-level-await guard checked 304 imports and 96 wrapped chunks with zero
  missing awaits.
- Root Turbo renderer typecheck/test: 1,961 passed, 0 failed, 2 fixture skips.
  Four new tests cover time-independent damping, conserved displacement, native
  pose parity, interruption/gating, and an external pivot's radius and pose.
  The camera tests first failed before the smoothing API was implemented.
- Five new viewer tests passed in the upstream sharded suite: six native
  directions, all 26 cube surfaces, roll, keyboard/Home/corner activation and
  disabled controls.
- Packaged WebView2 smoke passed on the final EXE: genuine file-input imports,
  six camera directions and active buttons, keyboard Top cycling with cube roll,
  cube pointer drag, actual edge/corner clicks, Home, two loaded IFC models and
  section-box activation. No page errors or console diagnostics were captured.
- The packaged smoke initially failed against the old EXE because the beveled
  cube was absent. A later screenshot caught unresolved theme variables; these
  were corrected and the smoke now also asserts face backgrounds exist.

## Pointer-driven motion measurement

`profile-navigation.mjs` launches the real release EXE with an isolated WebView2
profile, imports `building-architecture.ifc`, records camera poses each animation
frame, performs 90 actual mouse moves for both canvas and cube, and captures a
CPU profile. No camera-state injection is used. The same test is used before and
after. Reports and CPU profiles are under `desktop/reports/`.

| Measurement | Before, model | After, model | Before, cube | After, cube |
| --- | ---: | ---: | ---: | ---: |
| Frames with camera movement | 90 | 810 | 90 | 758 |
| Moving frames after release | 0 | 77 | 0 | 84 |
| Settling after release | immediate | 350 ms | immediate | 396 ms |
| Frame interval, p95 | 4.24 ms | 4.23 ms | 4.22 ms | 4.22 ms |
| Frames over 25 ms | 0 | 0 | 0 | 0 |

The measurement identifies stepped input delivery rather than insufficient FPS
on this small model. Smoothing fills the intervals between pointer samples while
keeping a bounded tail. It does not establish large-model FPS, GPU residency or
human-perceived parity with TestIFC. TestIFC's actual camera source enables
OrbitControls damping with a factor of 0.08; the new implementation uses elapsed
time so refresh rate does not change its response.
A second successful run measured 805/753 moving frames and 338/392 ms settling
for model/cube respectively, with p95 frame intervals of 4.23/4.20 ms. One
intermediate repeat failed its post-release-motion assertion; its log is retained,
so these results are not a claim that every automated gesture is reproducible.

## Panel-motion follow-up (source and development runtime only)

After the orbit build, the user requested no further rebuild and asked to check
Properties and Hierarchy animation. No desktop or frontend production build was
run for this follow-up. Root Turbo typecheck/test tasks used `--only`, reusing
already built dependencies. The packaged EXE above does **not** contain the
following panel changes.

The same pointer-driven panel probe found zero content animations for eight
actions on the existing EXE. Source changes now add 140 ms opacity/translation
when switching tab content and right-side panels, and 140–160 ms Radix disclosure
height transitions. Hierarchy uses a bounded FLIP animation over mounted rows
after explicit expansion/grouping actions, preserving the virtualizer's own
positions. Scroll cancels row animations; ordinary scrolling starts none.
Repeated actions capture displayed positions before cancelling prior motion.
Native hidden-row opacity is preserved, and animations release references on
finish/cancel/unmount. Expected animation-cancel rejections are handled.

The probe loaded the real IFC into the existing WebView2 EXE navigated to the
development server at `http://127.0.0.1:3000/`. It verified eight animated actions:
hierarchy expand/collapse, Properties/Quantities tabs, attribute-group close/open,
Model inspector and Properties panel. Reduced-motion mode produced zero new
content animations, and rapid tab switching and keyboard expansion kept the
correct final state. No page errors were captured. Fifteen relevant upstream
tests passed (tree ARIA/keyboard/virtualization, expansion reuse and property
disclosures/focus). Viewer typecheck also passed. Reports/screenshots:
`reports/panels-before.json`, `reports/panels-after.json`, `reports/panels-after.png`.

This validates behavior and actual animation playback on the bundled small IFC;
it does not establish large-tree/model latency or packaged-runtime behavior for
the panel changes, which await a later user-authorized build.

## Dock open/close follow-up

The user's screenshot clarified that the missing motion was opening/closing the
whole left Hierarchy and right Properties docks. Content-entry effects above
did not animate that layout change. On the baseline source, all four pointer
gestures changed width in one step (zero intermediate frames). Reopening the
Properties dock also rebuilt its content. A fresh small-IFC baseline recorded
a 150 ms maximum frame interval on that gesture; this is an observed interval,
not a CPU attribution or a large-model benchmark.

The source now interpolates the left resizable group's outer flex weights and
the right dock's width over 300 ms with easing. Right content stays mounted and
at a stable inner width while clipped; `inert` and `aria-hidden` prevent closed
panels taking focus. Memoization avoids rerendering the panel host only because
the outer dock changes width/mode; its state/context subscriptions stay live.
Divider dragging disables the tween. The drag calculation also uses the rail's
actual 64 px width instead of the stale 48 px constant.

The WebView2 development probe passed for both an unloaded app and the actual
small IFC. It checks intermediate widths in both directions, a bounded moving
interval, retaining the same panel DOM, rapid reversals, zero intermediate frames
in reduced-motion mode, and a direct divider drag with no width jump on release.
The loaded final check is `reports/panels-dock-verified.json`; the unloaded check
is `reports/panels-dock-empty.json`. Viewer typecheck passed; 38 tests passed
across three targeted Turbo shards (including split-divider, rail localization
and layout-reset regressions). No production build was run for this follow-up.

In the first completed 300 ms loaded-model check, close/open Hierarchy had 24/35
intermediate-width frames; close/open Properties had 28/23. Frame-interval p95
was 8.34–12.45 ms, but maximum intervals were 33–92 ms and each gesture still
had one or more frames over 25 ms. CPU profiling also captured MapLibre shader
work and React development rendering. These data establish width animation and
correct interruption, not universal jank-free playback or production/large-IFC
performance. Earlier 280 ms trials and their failed motion assertions are
retained; the final easing/duration was changed to make the travel less abrupt.

## Upstream suite limitations

The full viewer suite was attempted through root Turbo in eight shards because
its single command exceeds Windows' argument limit. Combined: 13,481 passed,
85 failed, 108 cancelled, 37 skipped. Failures are in upstream test tooling:
the contrast harness requires a missing Google Chrome installation; some tests
import Windows absolute paths without file URLs; a fixture extractor matches LF
literally against a CRLF checkout. The affected harnesses/tests are unchanged
from `v10.3.0`. This is not a full-suite green result. Logs are preserved.

Two-model smoke still shows the previously observed EPSG:32760 reprojection
warning for the bundled revision fixture. Local rendering works, but real-world
federation alignment remains unverified and is unrelated to this navigation
change. Large IFC models were not used for this motion measurement.

## Current engine

The Tauri host is native Rust x64; the bundled IFC geometry engine remains
`@ifc-lite/wasm@10.3.0`. Its actual binary declares memory64=false and a maximum
of 65,536 pages, or 4 GiB of linear memory. This is not the total app RAM limit
or a guaranteed IFC file-size limit. This describes the saved baseline. A native
Rust x64 preview has since been implemented and packaged-tested; see
`NATIVE-BACKEND-VALIDATION.md` for coverage and remaining migration gates.
The normal UI build retains WASM as default while the preview is qualified.

References: [desktop guide](https://ifclite.dev/docs/guide/desktop/),
[V8 WASM32 memory](https://v8.dev/blog/4gb-wasm-memory).
