# TestIFC Section Box in IFC-Lite

Source: `codex/desktop-v10.3.0`, based on upstream v10.3.0. The change starts at
`bd7e031`. TestIFC reference: `F:\Steel\VBA\IFC`, `aa8e62d`:
`section-box-controller.ts`, `viewer-clipping.ts`, `SectionBoxPanel.svelte`,
and the `beginSectionBox` workflow in `viewer.ts`.

## Behavior

Choose **Section → Box** to move to Top View and draw a rectangle. The completed
box keeps the model's full elevation, restores the preceding view direction and
projection, and frames the box through IFC-Lite's camera fit policy. **Draw again**
repeats that workflow. An invalid rectangle leaves drawing armed for another try.
Escape, pointer cancellation or losing window focus cancels the operation.

Six diamond handles move the faces along IFC-Lite world axes. A face whose axis
projects to a point still moves through vertical dragging, as in TestIFC. Escape
restores the complete box. Pointer capture, temporary navigation restrictions
and scan preview stride are released on completion/cancellation/unmount.
Arrow Up/Down on a focused handle changes its coordinate by 0.1 m.

The limits panel displays engineering IFC axes: IFC X = world X, IFC Y = negative
world Z with exchanged min/max, IFC Z = world Y. Invalid or inverted inputs do not
change clipping. IFC-Lite's existing minimum thickness of 0.05 m still applies.
**Reset Bounds** uses the canonical placed model/federation bounds; **Fit View**
only moves the camera. The existing toolbar **Fit** still fits the box to the
selection or model. **Cut**, **Show Box** and **Show Handles** are independent.
Closing the controls retains the native scene cut.

Only Box receives the new interaction. Plane, face and alignment clipping still
use IFC-Lite's existing tools. The quick-tool rail hides while the Box panel is
open to keep the same viewport area clear. No model-tab or saved-view workflow
was ported from TestIFC.

## Integration

`sectionPlane.box` remains the only clipping state; no renderer, shader, parser
or Rust changes are needed. The UI uses the existing scene projector and HUD.
The native camera feed wakes Box anchors for programmatic view changes, roll and
orthographic zoom without introducing another continuous animation loop.

Drawing is a transient transaction. Cancel restores the previous cut, last-used
mode and exact camera pose. Model geometry/placement changes invalidate the
transaction; metadata-only updates that replace the models Map do not. Four
unprojected corners cover rolled/building-aligned Top views. The resulting cut
is a world-axis-aligned box; a rotated screen rectangle is enclosed by that box.

## Verification — 2026-10-03

- Root Turbo viewer typecheck: 49 tasks successful, including viewer test sources.
- Focused root Turbo test shards: 65 tests pass, none fail. Math, drawing lifecycle,
  face dragging, native camera-feed projection, panel controls and native plane
  regressions are covered. Box shards: 1051, 408, 3194, 1819, 2707 of 4096; the
  quick-tools shard contributes 21 tests including colliding test files. This is
  targeted coverage, not a full viewer-suite run.
- Module-size ratchet against `bd7e031`: passes, no budgets raised.
- WebView2/WebGPU: 26 combined Box/navigation checks pass with the edited frontend
  served at localhost (16 checks when only the Box extension is enabled).
  Actual pointer input covers drawing, face drag/cancel, Top elevation dragging,
  numeric edits, reset/fit, display switches, closing/reopening, native plane
  switching, cube/views, two IFC imports and a federation Box sweep.
- Visible handle centres are checked against native projected world coordinates
  within 1 CSS pixel after Top, Fit View and Home. GPU cut on/off captures hide
  scene/HUD/cube/tooltip overlays and hold the camera fixed; their pixels differ.
- Runtime reports contain no page errors. Evidence: ignored
  `desktop/reports/section-box-webview.log`, `smoke.json`,
  `testifc-box-sweep.png`, `testifc-box-cut-on.png`, `testifc-box-cut-off.png`,
  and `two-model-section.png`.
- Independent oxlint runner: 8,134 files checked across all four target groups,
  zero errors. Box and changed quick-tool modules have zero warnings. Literal
  localization and type-scale gates pass; no quality baselines were raised.

The complete `pnpm lint` chain is not green on this Windows checkout. The
unused-local ratchet compares Windows paths such as `packages\\sdk` with POSIX
baseline keys, treating existing counts as new regressions. The whole-repo
accessibility ratchet also reports three existing `ViewCube.tsx` group-role
warnings; this Box change does not edit that file. An additional
`--noUnusedLocals` viewer typecheck reaches existing unused imports in source
dependencies; it produces no diagnostics in changed Box/quick-tool modules.
The normal required viewer typecheck passes. These broader audit failures were
kept visible; they were not silenced or re-baselined.

This runs the real desktop WebView2 host with the current Vite frontend and web
IFC loader. It does not validate a newly packaged frontend or new native ingest.
The existing Native Preview EXE is unchanged, SHA256
`3B09A0A596B63E224703F4F316EC9E3624C74DC5A197F8B8DF1BF1DAC5C79AF7`.
No EXE rebuild, upload, push or GitHub Action was performed.

The second public sample retains the existing EPSG:32760 federation reprojection
warning. These checks establish Box behavior in the displayed local frames;
they do not establish GIS alignment accuracy or large-model performance.

Reproduce desktop checks from the repository root, with desktop Vite running:

```powershell
$env:SMOKE_URL = 'http://127.0.0.1:3000/'
$env:TESTIFC_SECTION_BOX_SMOKE = '1'
$env:TESTIFC_NAVIGATION_SMOKE = '1'
node desktop/smoke-webview2.mjs
```
