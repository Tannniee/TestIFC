# TestIFC navigation and quick tools

Implemented in `F:\Steel\VBA\IFC-Lite` on `codex/desktop-v10.3.0`,
starting from native-preview commit `eadd8f5`. Reference: TestIFC checkout
`F:\Steel\VBA\IFC`, branch `codex/testifc-1.0.3a`, commit `aa8e62d`.
The reference checkout, Rust native importer and saved release EXEs are unchanged.

## Camera behavior

The existing IFC-Lite camera, geometry and picking pipeline remain authoritative.
The TestIFC profile adapts their input response:

- Orthographic startup, cursor-anchored wheel zoom with the original
  `0.95 ^ (-pixelDelta / 100)` size factor. Line/page wheel units and Ctrl
  pinch normalization follow TestIFC's Three OrbitControls version. No wheel inertia.
- Left drag rotates by `2π * displacement / CSS viewport height`.
  The original TestIFC damping factor of 0.08 at 60 Hz is expressed as a
  time-based decay, including pan, without discarding unspent pointer movement.
- Pan follows camera screen axes and scales with the visible height, preserving
  its pixel displacement at different orthographic zoom levels.
- Model navigation keeps a stable orbit target; select-orbit moves that target
  to canonical placed component bounds in 340 ms while preserving scale and distance.
- View changes use cubic ease-in-out and quaternion SLERP. The base duration
  is 420 ms, extended for zoom-out and larger rotations. Explicit viewpoints
  cancel earlier tool/view animations.
- IFC-Lite's Y-up renderer camera, IFC-display axis labels, existing six views,
  scene fitting, clipping, coordinate rebasing and federation remain in use.

TestIFC becomes the initial browser profile, with a one-time migration of the
old default preference. Deliberately selecting the original Default profile
subsequently persists. Navisworks/Trackpad preferences remain selectable.

## Quick tool connections

| Tool | Connection |
| --- | --- |
| PAN | Existing camera; left orbit, middle/right screen pan, return from select-orbit to model center |
| Select orbit center | Canonical IFC-Lite selection and placed selection bounds, including global model IDs |
| Multi | Existing GPU rectangle picking and multi-selection store; middle drag orbits; modifiers swap pan/orbit |
| Measure | Existing snapping, measurement store, overlays and tool bar; drag distance and click-based polyline |

The old TestIFC edge-only measurement interface is not duplicated. This rail
uses IFC-Lite's existing measurement modes and snapping. The full native
measurement tool bar remains available. Ribbon actions and the rail share tool
state. Non-navigation buttons are disabled before a model is loaded.

The active Properties activity icon now collapses the right dock. Clicking it
again opens Properties. A non-active panel switches to Properties normally.
The collapsed icon no longer displays an active-docked state. Existing dock
motion and reduced-motion behavior remain in use.

Rectangle drags now mark themselves as drags before asynchronous picking, so
the browser's subsequent click cannot overwrite the multi-selection result.

## Validation on 2026-10-03

- Root Turbo renderer build and typecheck passed. Renderer tests:
  **1,967 passed, 0 failed, 2 existing skips**. New behavioral tests cover cursor
  invariance, exact wheel reversal, viewport/refresh-rate independence, accumulated
  pan input, explicit-pose cancellation and opposite-view transition radius.
- Viewer typecheck passed through root Turbo. Focused root-Turbo test shards
  passed for Properties toggling, preference migration, navigation gestures and
  rendered quick-tool/ribbon state. The complete upstream viewer suite was not run.
- Module-size ratchet passed against `eadd8f5`, with no new/raised budgets;
  `git diff --check` passed. Public renderer entry-point export names are unchanged.
  The whole-repo API-surface check could not complete: unrelated package `dist`
  declarations are absent. They were not rebuilt merely to run that unrelated gate.
- Actual WebView2/WebGPU testing used the existing desktop EXE as a host for the
  edited Vite frontend at `http://127.0.0.1:3000/`, importing the committed
  `building-architecture.ifc` and revision-B samples through the regular loader.
  **17 smoke checks passed, no page errors**: actual wheel, orbit/pan damping,
  component-click selection and pivot, ten-element rectangle selection, snapped
  distance drag, polyline completion, Properties icon toggling, themed rail,
  six Y-up views, cube/roll synchronization, two-model loading and section box.
  Reports: `desktop/reports/smoke.json`, `testifc-live.log`, `testifc-navigation.png`.
- Dock motion was checked in WebView2 with a real loaded IFC: Hierarchy and
  Properties opened/closed over about **287–296 ms**, with intermediate frames;
  reduced-motion mode removed the transitions. Report:
  `desktop/reports/panels-testifc-final.json`. Some long frames were observed;
  these small-model checks do not establish a general FPS guarantee.

## Verification limits

No new EXE or installer was packaged for this change. These are source-frontend
WebView2 checks, not a claim that saved EXEs include this UI yet. The localhost
frontend used the web/WASM geometry loader: the production Tauri capability
policy correctly rejects native commands from that remote localhost origin.
The earlier embedded native-preview validation remains separate. Neither this
camera work nor its samples prove loading an IFC larger than 4 GiB.

The revision-B sample still reports its existing EPSG federation-alignment
warning in this run. No GIS/CRS accuracy claim is made here. TestIFC's renderer
or adaptive-resolution implementation was not transplanted; IFC-Lite keeps
its own WebGPU rendering and frame scheduling.
