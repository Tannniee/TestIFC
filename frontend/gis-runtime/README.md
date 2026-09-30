# Isolated BIM–GIS runtime

Based on [Helen Kwok / bim-gis-viewer](https://github.com/helenkwok/bim-gis-viewer),
commit `e3de3b97c0d37b7feb3211b30cd8fe8393c31e01` (Apache-2.0).
The npm lockfile starts from that commit. Its resolved IFC.js versions are
`web-ifc-viewer 1.0.209`, `web-ifc-three 0.0.118`, `web-ifc 0.0.35`,
`three 0.135.0`, and `dexie 3.2.2`. Mapbox GL JS `2.10.0` and Geocoder
`5.0.0` are bundled locally instead of loaded from the demo's CDN.

## Build

From `frontend`: `pnpm gis:install`, then `pnpm gis:build`.
`pnpm build` builds this runtime before Vite; `BuildFrontend.cmd` also performs
the isolated frozen npm installation. Fresh development setup needs
`pnpm install --frozen-lockfile` and `pnpm gis:install` before `pnpm dev`.
Generated files live in `public/vendor/bim-gis` and are packaged by Vite.
They are ignored in Git. No user key is compiled into these assets.

## Contract and ownership

The normal Svelte/Fragments viewer retains its existing Three/WebIFC versions.
This same-origin iframe owns the old dependencies, Mapbox WebGL context,
converter workers and glTF resources. Both sides accept messages only from
their exact peer window and origin, on `testifc-bim-gis-v1`.

Parent commands: `token`, `document` (File + SHA-256), `anchor`, `pick`,
`marker`, `fly`, `globe`, `resize`. Replies: `ready`, `map-ready`, `progress`,
`model-ready`, `picked`, `model-error`, `map-error`, `cache-warning`.
Tokens are public `pk.` tokens, sent at runtime from user settings.
Changing token rebuilds only Mapbox, preserving camera and the loaded scene.
Changing active document recreates the iframe and terminates converter workers.
Only one model is attached to the map. Models are cached in the separate Dexie
database `TestIFC-BimGis`, keyed by pipeline version and source SHA-256.

Conversion follows the upstream IFC.js `exportIfcFileAsGltf` pipeline, retaining
both GLB data and JSON properties. We export the complete loaded mesh, without
the demo's category allowlist (which omits beams and other valid products).
No triangle cap is applied. Pset/Qto and relationship panels continue to use
the current TestIFC semantic service; the legacy JSON cache does not replace it.

## Restoration fixes

- Public token injected at runtime; no browser `process.env` reference.
- Original reference checkout declares `coordinatesData`.
- Original reference initializes fog in `style.load` rather than `load`.
  Mapbox 2.10 otherwise queries marker opacity before fog has been evaluated
  when searching and moving the pin. The integrated runtime uses the same fix.
- WebIFC 0.0.35 uses `./` relative to its worker for WASM, because it prefixes
  even absolute paths with its own script directory.
- Scoped patches await the legacy worker's asynchronous actions, reply with
  failures, and reject pending loader promises on worker errors. Failed exports
  also dispose the exporter's temporary IFC loader. Invalid WASM now produces
  an error message instead of leaving conversion pending indefinitely.
- A scoped IFC.js patch handles valid missing building placements in the
  JSON serializer's `globalHeight` metadata. It does not alter geometry.
- Globe overview switches to Mercator for the IFC custom layer. The layer
  attaches after the projection's style transition finishes.
- Static models repaint on interaction; no permanent repaint loop.

The manual pin represents the horizontal glTF bounds center. Elevation is the
bottom of those bounds; positive yaw is clockwise, scale is unitless. Manual
placement is not survey-verified CRS georeferencing. Existing CRS backend
endpoints remain available for a later explicit georeference mode.

Reference API: [Mapbox custom layer example](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/),
[projection limitations](https://docs.mapbox.com/mapbox-gl-js/guides/projections/).

## Verification

`node e2e/mapbox-smoke.mjs` from `frontend` uses the built application and a
temporary authenticated Python bridge. Set `MAPBOX_TEST_TOKEN` or put a public
key in ignored `frontend/.env.local` as `VITE_MAPBOX_ACCESS_TOKEN`.
`IFC_E2E_BIM_FIXTURE` optionally selects a real IFC. Screenshots go to ignored
`reports/mapbox`. The test covers real Mapbox, conversion, JSON cache, model
rendering, placement, cancellation, settings replacement, viewer switching and
cache reopening. It does not establish arbitrary-file geometry parity.

`node e2e/run-bim-gis-checks.mjs` runs the Settings, failed-WASM recovery,
Project Browser and Pset/Qto/relations regression checks against a local bridge.
`node e2e/webview2-smoke.mjs` verifies the packaged executable when
`IFC_VIEWER_EXE` and `IFC_E2E_MODEL_PATH` are supplied. Its settings persistence
uses the real desktop API and an isolated user profile.

The pinned reference can be restored with
`benchmarks/restore-bim-gis-reference.ps1` and tested from `frontend` with
`node e2e/bim-gis-reference-smoke.mjs`. Four screenshots are saved in
`reports/mapbox-reference`; the integrated desktop captures are in
`reports/mapbox`. Geocoder, pin movement, globe/model flight, building context,
camera rotation and marker toggles were checked with the upstream `01.ifc`.

Bundled license copies include the upstream Apache-2.0 notice, Mapbox's SDK
terms, Three/Dexie/Geocoder licenses, IFC.js MIT notices from npm's recorded
source commits, and WebIFC MPL-2.0. The WebIFC license source is
`8f8847c246d2bd01035c62bf44f66965ef6b5c07`, the last LICENSE.md revision before
the pinned package. The two IFC.js source commits are
`ba73310893f2f2234ead18519635bb82b159b28d` (web-ifc-three) and
`a2d984cec75b509032f9f56f0b4bc8acee5d893d` (web-ifc-viewer).
