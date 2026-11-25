# Stationary 3D view and Colorizer interactions — 16 October 2026

Delivered candidate: [IFC-Lite.exe](release/10.3.0-native-interactions-20261016-r2/IFC-Lite.exe).

SHA-256: `8e2ad2fd94f507eddd75249e1a36e59ecc3516193cfd53aa975eb768c9eed848`.
Checkout: `F:\Steel\VBA\IFC-Lite`, branch `codex/desktop-v10.3.0`, base commit
`471284f476d64a659ae607eeec2115ca3afcb9fe`, with the existing local native-host
changes. [Provenance](release/10.3.0-native-interactions-20261016-r2/provenance.json)
records hashes of the changed source files and the executable.

## Behaviour

- The desktop camera surface belongs to a fixed stage. Ribbon, Hierarchy,
  right-side docks and bottom panels cover that surface instead of resizing it.
  This also applies to the Model workspace's Plan/3D split. Explicitly dragging
  the internal Plan/3D splitter still resizes those panes deliberately.
- HUD controls follow the space left by covering panels. World-anchored scene
  overlays continue using the actual camera viewport. Opening a panel may cover
  geometry; it does not reframe, scale or translate the model.
- Ribbon height and dock width/height use the same 240 ms easing. Closed docks
  cannot receive input. Bottom content is retained through its closing motion,
  then released. Reduced-motion mode disables these transitions.
- Repeating a right-panel action closes its dock. It does not substitute
  Properties. Ribbon and rail use the same toggle action; detached-panel
  re-docking still goes through the canonical store action.
- One double-click toggles the ribbon in either direction, including when its
  first click opens a collapsed active tab.
- Orbit-selection and multi-selection to PAN preserve camera position, target
  and orthographic scale. Choosing an orbit pivot no longer frames the model.
- Leaving a live Box draw restores orientation and scale in the same camera
  animation. Finishing a box restores the source view without starting a second
  competing fit; the explicit box Fit command remains available.
- Colorizer no longer rebuilds identical preview colours on regroup. Its group
  picker stays in place and the list does not flash disabled while regrouping.
  Group checkboxes drive the canonical global-id selection/highlight channel.
- The explanatory subtitle is removed. Transparency sits beside the colour
  picker, and **Save as** is a small bottom-right action.
- Right-click **Colour selection** offers swatches and a custom colour. Clicking
  inside an existing selection paints that selection in the clicked IFC model;
  clicking outside it targets that object. Quick colour uses the same source,
  draft, Undo/Redo and full-model export as the Colorizer panel.

## Packaged validation

The exact delivered EXE was exercised through an isolated WebView2 profile,
using `hangarvd_f10_ tan base_f01_colored.ifc` (14,509 colourable products).
The user's screenshot model was not supplied for this run.

[Runtime report](../research/colorizer-20261015/native-interactions-r2/report.json):
**53 assertions passed; 0 page errors.**

- **44 animated transitions** covered ribbon, Hierarchy, all 16 tested right
  panels, bottom panels, and Plan/3D. Every sampled canvas rectangle stayed
  identical. Three projected world points had **0 px maximum drift** throughout
  each transition. There were 10–21 intermediate frames per transition. This
  proves the stationary projection, not a universal FPS budget for every model.
- Four consecutive real ribbon double-clicks toggled correctly on their first
  double-click.
- Ticking `PIPE-267.4X8` highlighted its 1,968 members. Class, material, storey
  and section regrouping retained the exact same preview layer object.
- Real Ctrl+click gestures selected five distinct objects:
  `58, 145921, 147928, 142617, 92148`. Right-click colour painted and saved those
  five. Undo removed that quick paint from the same draft.
- Box-to-plane restoration traversed **41 distinct camera poses**.
- The downloaded IFC reopened in the native renderer with the original totals:
  **1,917,264 vertices and 1,681,800 triangles**.

The runtime report retains two handled warnings: a missing-project unit fallback
while entering the authoring workspace, and an empty frame-selection request.
They are not counted as page errors. This run does not establish correctness of
that unit fallback for arbitrary models.

## Independent IFC oracle

[Oracle report](../research/colorizer-20261015/native-interactions-r2/five-selection-oracle.json)
uses IfcOpenShell 0.8.5 only as a test tool. The application remains Rust/native;
no Python or IfcOpenShell runtime dependency was added.

- 5 red products, 14,504 gray; 14,509 styled body items.
- All **184,677 non-presentation records** remained identical by entity id.
- Eleven representative products retained world-space vertices to `1e-10` and
  identical triangle indices; the oracle also checked their rendered materials.
- Source SHA-256 remained
  `df595b8d150b09dabbc48e21f6efd1b26a0f35ab07636a02d0b51896b94894a2`.
- Export: 11,874,073 bytes, SHA-256
  `bc26ce12c8e3e6fd49a550a26d4a3929b1e5e2261e843037d651e665bf1378a7`.

## Source checks and limits

- Root Turbo typecheck: 109 tasks passed; 3,260 test files covered by typecheck.
- Root Turbo focused tests: 17 Colorizer/navigation/ribbon/panel tests,
  8 Box-controller tests, 7 bottom-header tests and 3 side-by-side tests passed.
- Root Turbo renderer tests: 1,995 passed, 2 skipped. This includes simultaneous
  camera orientation/scale interpolation.
- Changed-file lint, i18n literals, source-assertion, module-size and public-export
  surface checks passed. The module-size merge-base audit was unavailable because
  this checkout has no merge base with `origin/main`/`main`.
- The repository-wide JSX accessibility ratchet still reports the 3 existing
  warnings in untouched `ViewCube.tsx`; its baseline was not raised.
- The full repository test suite and every IFC schema/texture combination were
  not rerun for these UI changes. Transparency continues to affect the exported
  IFC; preview remains opaque, and textured previews can retain their pattern.

Previous release files were preserved. In particular the earlier Colorizer UX r2
still hashes to `e7319fee48a596815605269e8cd310807d262f1b069a3911d885045c0a48f328`.
