# BIM–GIS runtime

Based on [Helen Kwok / bim-gis-viewer](https://github.com/helenkwok/bim-gis-viewer), commit `e3de3b97c0d37b7feb3211b30cd8fe8393c31e01` (Apache-2.0). An isolated Three 0.135 renderer supports Mapbox GL JS 2.10's WebGL1 context; Geocoder 5.0 is bundled locally. Conversion uses the main frontend's installed, patched WebIFC 0.0.78 and matching WASM. The legacy IFC.js converter is no longer used.

## Build

From `frontend`: `pnpm install --frozen-lockfile`, `pnpm gis:install`, then `pnpm build`. `BuildFrontend.cmd` runs frozen installs and checks. Rollup bundles the renderer and a separate conversion worker. Generated assets in `public/vendor/bim-gis` are ignored in Git and packaged by Vite. Public Mapbox tokens are supplied from user settings at runtime.

## Placement

The pin represents the horizontal bounds center. WebIFC converts lengths to metres; scale defaults to 1. Positive yaw is clockwise around the pin. `elevationMeters` is road altitude. Optional `groundOffsetMeters` is the chosen datum above the model bottom, before scaling. The initial datum is IFC engineering Z=0 if it lies inside the bounds, otherwise the model bottom.

- **Place marker:** click the map or drag the pin.
- **Align to road:** click a visible slab/foundation surface to move its selected height to road altitude. Dimensions and yaw stay unchanged.
- **Rotate in place:** drag horizontally or enter yaw; the pin stays fixed.
- **Reset / Cancel:** restore the last saved placement, or the initial placement before the first save.
- **Underground:** show geometry below the selected datum. Normally it is clipped, including piles; its geometry remains cached.
- **Smooth:** defer very small projected meshes, such as bolts. Navigation uses a slightly higher threshold; hysteresis limits repeated visibility toggles. Zooming closer restores details. **Detailed** draws all geometry.

The anchor and ground datum are saved per source SHA-256. Manual placement is not survey-verified CRS georeferencing.

## Geometry and lifecycle

The worker streams all WebIFC meshes. Shared geometry is encoded once using standard glTF `EXT_mesh_gpu_instancing` translation/rotation/scale attributes. Repeated geometry is not expanded into millions of individual nodes/triangle copies. Coordinates remain doubles until rebasing near model and mesh origins, before Float32 conversion. Bounds use transformed vertices. Invalid/zero extents and zero-triangle output fail instead of reporting ready.

The versioned Dexie cache stores GLB plus JSON placement metadata: coordination matrix, bounds, counts, project/storeys and reader warnings. It invalidates old IFC.js exports, including collapsed TTHC geometry. Full property/Pset/Qto/relationship services retain ownership of BIM semantics. No triangle cap is applied; Smooth changes visibility only.

The iframe, map and marker persist through edits and document replacement. Replacing a document cancels the old worker, disposes GPU resources and guards against stale results. Token replacement preserves scene and camera. Rendering follows map interaction instead of a permanent repaint loop. Transitions respect reduced-motion preferences.

Both peers verify source window, same origin and `testifc-bim-gis-v1` channel. Commands: `token`, `document`, `anchor`, `mode`, `marker`, `underground`, `details`, `fly`, `globe`, `resize`, `appearance`. Replies: `ready`, `map-ready`, `progress`, `model-ready`, `model-visible`, `picked`, `surface-picked`, `pick-missed`, `model-error`, `map-error`, `cache-warning`.

## Verification

- `pnpm test`: placement maths, shared GLB transformed-vertex parity at large coordinates, collapsed-output rejection.
- `node e2e/mapbox-smoke.mjs`: built app and authenticated bridge, real Mapbox/IFC draw, clicked surface, fixed-pivot drag rotation, reset, saved datum, marker stability, detail restoration, token replacement, cache and document lifecycle. `IFC_E2E_BIM_FIXTURE` selects a real file.
- `node e2e/mapbox-model-check.mjs <IFC files...>`: cold conversion, nonzero bounds/draw, screenshots, warnings, and CECO detail restoration after zoom. Outputs are in ignored `reports/mapbox-models`.
- `node e2e/run-bim-gis-checks.mjs`: settings, failed-WASM recovery, semantic and tree regressions.
- `node e2e/webview2-smoke.mjs`: packaged application; set `IFC_VIEWER_EXE` and `IFC_E2E_MODEL_PATH`.

Live tests need `MAPBOX_TEST_TOKEN` or an ignored `frontend/.env.local` public `VITE_MAPBOX_ACCESS_TOKEN`. Readiness and triangle counts do not establish arbitrary-file geometry parity with an independent IFC engine. Verify affected products when WebIFC reports geometry warnings.

Official APIs: [Mapbox Map API](https://docs.mapbox.com/mapbox-gl-js/api/map/), [WebIFC API](https://thatopen.github.io/engine_web-ifc/docs/classes/web-ifc.IfcAPI.html). Bundled notices include upstream Apache-2.0, Mapbox SDK terms, Three/Dexie/Geocoder licences and the installed WebIFC MPL-2.0 licence.
