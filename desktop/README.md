# IFC-Lite 10.3.0 desktop baseline

This host embeds the viewer from upstream tag `v10.3.0`, commit
`e79f27342beb01a6f30d9b63c44795ecd118f4de`, in Tauri v2 on Windows.
Model loading, federation, section tools and GIS start from upstream.
Navigation now uses the TestIFC beveled cube and six quick-view icons, adapted to
IFC-Lite's native Y-up axes (+Y top, +Z front, +X right). Named views and Home use
the existing viewer camera callbacks; edge/corner views keep the current target,
distance and projection. The cube reads the full camera pose, including roll.
Mouse and cube orbit now spend pointer displacement over animation frames with
60 ms time-based damping. This keeps native axes, pivots and total rotation;
Home, presets, explicit poses and model resets cancel any remaining movement.
Walk and other direct camera consumers keep immediate controls.

The initial desktop app uses the published `@ifc-lite/wasm@10.3.0` engine, bundled
locally with the viewer. A separate native preview now reads STEP IFC sources,
meshes with the pinned Rust processing pipeline, and hydrates BIM tables without
placing the whole IFC source in WebView2. See `NATIVE-BACKEND-VALIDATION.md` for
what is verified and the remaining migration work.
`wasm-geometry.ts` keeps default geometry consumers on WASM inside a Tauri host,
including export consumers that otherwise auto-detect native mode. It does not
modify the geometry sources. Viewer navigation changes are in
`apps/viewer/src/components/viewer/`.
The desktop build also omits Vercel's web deployment analytics component: its
`/_vercel/insights/script.js` endpoint does not exist in the local host.

## Build on Windows

Prerequisites: Node 24, Rust stable (1.99 tested), MSVC C++ Build Tools, WebView2, and Git Bash.
The upstream Rust/WASM workspace keeps its own pinned nightly toolchain; this
independent shell uses stable. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

From the repository root, install upstream dependencies using pnpm 10.8.1:

```powershell
npx --yes pnpm@10.8.1 install --frozen-lockfile
cd desktop
npm ci
npm run build
```

The host builds upstream workspace dependencies, then builds the original viewer
with a desktop-specific Vite config. The build fetches the matching prebuilt WASM
only if it is missing, using the upstream Windows fallback script. Existing
source-built WASM is retained. Install `wasm-pack` and the upstream pinned nightly
to rebuild the engine from Rust instead.

Output: `src-tauri/target/release/ifc-lite-desktop.exe` and the NSIS installer under
`src-tauri/target/release/bundle/nsis/`. The standalone EXE embeds frontend assets;
WebView2 is required. Model processing can use local files without a server. Maps,
online tiles, geocoding and external service features need their respective
providers/network setup.

`npm run dev` opens the desktop host with the desktop Vite configuration. Keep
port 3000 free. Reuse the same host for subsequent native backend and feature work.

After building, `npm run test:packaged` launches the release EXE with an isolated
temporary WebView2 profile, loads two IFC files using the viewer's file inputs,
checks all six views, cube dragging, keyboard activation, corners/edges, and
enables the section box through the UI. Reports and screenshots go to
`reports/`. This requires the root Playwright dependency installed above.
`node profile-navigation.mjs` records pointer-driven model/cube motion and a
WebView2 CPU profile. Set `PROFILE_LABEL` to distinguish before/after reports.
See `VIEWCUBE-VALIDATION.md` for measured results and upstream suite limitations.
Panel dock animations have also been verified in the packaged UI baseline
`release/10.3.0-ui-0756f24/`, including loaded-model open/close, reversal,
reduced motion and direct divider resizing. `inspect-panel-motion.mjs` checks
the current EXE by default; set `PANEL_URL=http://127.0.0.1:3000/` and a
`PANEL_LABEL` to check source changes served by the desktop Vite config.
Add `DOCK_MOTION=1` and `EXPECT_DOCK_MOTION=1` to measure actual Hierarchy and
Properties dock widths, including rapid reversals, reduced motion and divider
resizing. `DOCK_EMPTY=1` checks the unloaded view. These checks reuse the existing
EXE as a WebView2 host; the check itself does not build anything.
See `NATIVE-BACKEND-RESEARCH.md` for the source-backed migration from WASM32 to
native Rust x64, including file I/O, semantic data and binary streaming.

## Native preview

`npm run build:native-preview` builds a standalone EXE with native STEP IFC
loading enabled and a distinct Native Preview window title. It does not create
an installer. `npm run build` keeps the complete WASM baseline as the default.
Do not overwrite the saved UI baseline with either build's target output.

`IFC_NATIVE_SMOKE=1 node smoke-webview2.mjs` exercises native loading, two models,
camera/cube controls and section box in packaged WebView2, and asserts zero WASM
instantiations on that load path and zero source bytes in the viewer datastore.
Add `IFC_NATIVE_DEFAULT=1` to check that the preview enables native without
a URL engine override. `node compare-engine-snapshots.mjs` compares the public
fixture snapshots captured using `ENGINE_SNAPSHOT_LABEL=wasm-baseline` and
`ENGINE_SNAPSHOT_LABEL=native-preview` on their respective packaged EXEs.
The native runtime can also be selected via `?engine=native` for validation.
Native failures surface as errors; they do not silently retry with WASM.
Native STEP transport also uses the canonical verified IFNS collation for
eligible repeated geometry, bounded binary messages and exact per-entity bounds.
Excluded geometry stays flat. The viewer yields between shard uploads and
waits for them before finalization. See `PVF-CRASH-VALIDATION.md` for the native
BIM memory/IPC repair and the October 9 actual-PVF completion/Properties/clean
close evidence. Subsequent [responsiveness validation](PVF-RESPONSIVENESS-VALIDATION.md) and
[the follow-up audit](NATIVE-RUST-DEEP-AUDIT.md) describe the current candidates.
These local probes do not establish full web-performance parity.

This is a migration preview: source-backed editing/IFC export, the complete
analytics/diff/symbolic surface, IFCZIP resources and large-file qualification
remain to be migrated or validated. Other formats and export-specific geometry
consumers keep the existing WASM implementation. A successful small-model run
does not establish that an actual IFC file over 4 GiB can be opened.

Upstream MPL-2.0 license and notices are retained. This is a local derived desktop
host, not an official desktop release from LTplus AG.

## Follow-up native audit

The native audit candidate is
`release/10.3.0-native-audit-20261009/IFC-Lite.exe`. It preserves full project
display units in source-less stores and removes redundant IFNS occurrence
materialization during census/color updates. Native stays the default.
See [the audit and runtime evidence](NATIVE-RUST-DEEP-AUDIT.md) for validation,
measured outcomes and remaining cancellation, upload and GIS limitations.

The next native candidate is
`release/10.3.0-native-followup-20261010/IFC-Lite.exe`. It cooperatively prepares
BIM indexes, the initial spatial tree and large GPU batches, and propagates
job cancellation through the canonical Rust semantic extractor.
See [follow-up performance evidence](NATIVE-RUST-FOLLOWUP.md) for measured
results, provenance and remaining qualification limits.
