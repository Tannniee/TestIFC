# BIM–GIS: placement tools and small-detail rendering

Date: 2026-09-30. Checkout: `F:\Steel\VBA\IFC`, branch `codex/testifc-1.0.3a`, base HEAD `cdcd428`. This validation was captured before source publication. Application version at this validation was 1.0.4; the combined release is 1.0.5.

## Reproduced causes

- CAMBO's previous bottom-of-bounds datum used the pile tips, placing the whole foundation above the road. Initial engineering Z=0 is now 39.25 m above the model bottom; users can choose another visible surface.
- CECO's legacy IFC.js export failed with `Invalid array length`. Streaming the file reveals 1,391,895 placed geometries and 57,193,973 triangles after repetition. The replacement encodes shared meshes once with GPU instances, avoiding the large flattened allocation and individual-node explosion.
- TTHC's old cached GLB reported 41,478 triangles but width/depth/height were all zero. Modern conversion yields 368,428 triangles and nonzero transformed bounds. Pipeline-version keys prevent reuse of the bad cache; zero-extent exports fail explicitly.
- HEINEKEN's independently measured dimensions are approximately 27.90 x 112.85 x 29.69 m: 29 m refers to height. Placement still defaults to scale 1, with a dimension HUD and metric map scale.

## Implemented

Three primary tools: align a clicked slab/foundation height to road level, rotate around the stationary marker, reset to the last saved placement. Quick map clicks and marker dragging place the model. Ground datum persists with the model-scoped anchor; underground geometry is clipped by default and can be shown.

The panel uses application tokens/icons, respects reduced motion, and keeps iframe/map/marker mounted during edits and document replacement. Stale conversion is cancelled and detached GPU resources are disposed.

Smooth display defers very small projected meshes, including bolts. Zoom restores details; Detailed restores all meshes. A higher navigation threshold and hysteresis reduce rapid visibility toggles. There is no triangle cap or permanent deletion of small components.

## Final real-file checks

Chromium, headless SwiftShader; cold IndexedDB per model. Times are worker/conversion/GLB readiness, not first visible pixels or app startup. They are single runs, not FPS benchmarks.

| File | Bounds width x depth x height, m | Cold GIS readiness | All triangles | Drawn at default view | Reader warnings |
| --- | --- | --- | --- | --- | --- |
| CAMBO BIM POWER BI.ifc | 49.7756 x 56.1479 x 126.65 | 1,106 ms | 85,581 | 85,573 | 88 |
| CECO.ifc | 6.2955 x 6.8501 x 27.9281 | 11,555 ms | 57,193,973 | 2,087,861 | 868 |
| TTHC-IFC.ifc | 305.7306 x 107.3300 x 172.1000 | 2,346 ms | 368,428 | 368,428 | 0 |

CECO deferred triangles dropped from 55,106,112 to 54,264,040 after zooming one step closer, proving that detail visibility restores. Counts vary with camera and viewport.

Evidence: ignored `reports/mapbox-models/results.json` and screenshots. Full app CAMBO smoke passed actual surface picking, pointer drag rotation, fixed pivot, reset, persisted surface datum, full-detail restoration, stable marker DOM, token replacement, cache reopening and document lifecycle. Cold viewer+GIS readiness was 3,287 ms; warm was 1,788 ms in that run, distinct from standalone conversion.

## Gates

- 199 Python tests passed, including anchor offset persistence and API validation.
- 58 frontend tests passed, including rebased transformed GLB vertex checks, selected-floor placement, and collapsed-output rejection.
- Svelte check: zero errors and warnings; production build passed.
- Six browser regressions passed: settings, failed-WASM recovery, Pset/Qto/material and tree/document boundaries.
- Packaged EXE built and WebView2 smoke passed with CAMBO: normal IFC geometry/semantic readiness, real Mapbox draw, rotation, saved placement, marker toggling, token persistence and viewer switching; graceful exit 0.

EXE: `dist-gis-tools-20260930/IFC Viewer 1.0.4.exe`. Screenshot: `reports/mapbox/desktop-cambo.png`. Build log: `reports/gis-tools-package.log`.

## Limits

Modern WebIFC geometry warnings remain visible for CECO/CAMBO. These checks prove conversion, bounds, rendering and controls, not independent per-product geometry parity for every IFC. The GLB vertex unit check exercises translation, rotation and nonuniform scale; it is not a complete IFC shape corpus. TTHC still has about 22,587 draw calls, so the triangle reduction result on CECO does not imply identical gains for all models. Full-detail mode on highly repeated files can require much more rendering work.
