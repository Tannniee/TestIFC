# Windows desktop baseline validation — 2026-10-03

Upstream: `https://github.com/LTplus-AG/ifc-lite`, tag `v10.3.0`,
commit `e79f27342beb01a6f30d9b63c44795ecd118f4de`.
Local branch: `codex/desktop-v10.3.0`. Upstream tracked sources are unchanged;
the derived desktop shell and build adapters live in `desktop/`.

Toolchain used: Node 24.19.0, pnpm 10.8.1, Tauri CLI 2.12.1,
Rust stable 1.99.0, MSVC 2022 Build Tools, Windows SDK 10.0.26100.0,
WebView2 154.0.4258.48. Engine: published `@ifc-lite/wasm@10.3.0`.

## Verified

- Original viewer build: all 49 dependency/viewer tasks passed.
- Desktop viewer build and release Rust build passed; NSIS x64 installer produced.
- Upstream top-level-await guard: no unawaited dependency chunks across 304
  static imports of wrapped chunks.
- `npm run test:packaged`: the actual release EXE, isolated WebView2 profile,
  default GPU configuration. Secure context, cross-origin isolation and WebGPU
  adapter all available.
- Real SketchUp-authored `building-architecture.ifc` opened through the file input:
  14 geometry meshes, visible model, screenshot visually inspected.
- Adding `building-architecture-rev-b.ifc` retained both models, 14 meshes each.
- Section tool's Box control populated a section box and displayed its size:
  `38.74 × 7.00 × 24.29 m`. Screenshot inspected. This is a UI activation check,
  not a proof of every clipping/handle gesture or geometry parity.
- No uncaught page errors or console warnings/errors in the final packaged run.
- Vercel deployment analytics omitted only for desktop, after its absent local
  script endpoint caused a syntax error in the first packaged run.

Raw build log, runtime report and screenshots: `reports/` (generated, ignored).
The EXE embeds the viewer assets and WASM; no separate local server is needed.
The NSIS installer was built but its install/uninstall lifecycle was not exercised.

## Observed limitation for the next BIM-GIS step

Upstream displayed a warning when adding the revision fixture:
`EPSG:32760 → EPSG:32760 reprojection failed`. Both models rendered, but the
second used its own local frame. Therefore this run does not establish correct
real-world alignment or GIS accuracy. The warning is retained in `reports/smoke.json`.
No upstream placement behavior was altered for this foundation milestone.

This baseline does not yet implement the optional native geometry commands in
the desktop guide. Large-model performance, native/WASM geometry parity, all
exports, GIS providers and the complete upstream test suite are not established
by the checks above. No changes were pushed or GitHub Actions requested.
