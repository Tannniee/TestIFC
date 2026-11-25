# Black OLED theme

Open **View → Settings → General → Theme → Black OLED**.
Light and the existing Dark palette remain available. The sun/moon shortcut
returns to the dark palette last chosen in Settings, including OLED.

OLED applies neutral black surfaces to the app chrome, ribbon, docked panels,
welcome screen, dialogs, popovers, viewport, drawing paper, and map controls.
Raised surfaces use neutral gray; selection, axes and status accents retain
their meaningful colors. Print preview remains white paper.

The stored theme is applied by the inline startup script and restored by the
store. OLED shares the dark CSS variants and has its own neutral palette.
GPU clear color is opaque black; overlay ink and halos follow that backdrop.
Native controls and every scrolling surface use the dark color scheme.
Scrollbar styling also covers the Properties dock and ActivityBar, which
previously lacked the optional scrollbar-thin class.

## Verification

- Root Turbo viewer typecheck: 49 tasks successful, including test sources.
- Five targeted viewer test shards: 85 tests passed, none failed or skipped.
  These cover Settings selection/persistence, theme shortcut behavior, document
  classes, GPU/drawing colors, renderer theme updates and overlay contrast.
- `node desktop/oled-theme-smoke.mjs`: 22 checks passed in the actual desktop
  WebView2 host navigating to the current localhost frontend.
  Settings selection, reload, theme toggles, dark native controls, all seven
  visible scroll regions, no white chrome surfaces and real IFC import passed.
  No page errors. Screenshots were inspected with and without the IFC model.
- Changed TypeScript files: oxlint passed without warnings or errors.
- Module-size ratchet against `4a3467e`, i18n literal and font-size gates passed.
- The whole-repository accessibility gate still reports three existing
  ViewCube role warnings. ViewCube was not changed by this work; the warning
  baseline was not raised.

Runtime details and screenshots are in ignored `desktop/reports/`:
`oled-theme-smoke.json`, `oled-settings.png`, `oled-empty.png`, `oled-model.png`,
`oled-typecheck.log`, `oled-test-*.log`, and the individual gate logs.

The WebView2 smoke uses the web/WASM IFC loader at localhost. This verifies
the current frontend in the desktop browser engine, rather than packaged
native IPC. The EXE and native Rust loader were not rebuilt or changed during
the initial theme implementation.

## Packaged build requested afterward

Built source `d40f7e8` with `npm run build:native-preview`, then copied the
standalone executable into `release/10.3.0-oled-native-d40f7e8/`.
The saved EXE was tested at `http://tauri.localhost/`, using its embedded
frontend rather than the dev server:

- Packaged native/Box/navigation smoke: 29 checks passed, zero page errors.
  Two IFC models used native loading, with 64-bit backend pointers, zero
  source bytes retained in frontend stores and zero WASM instantiations on
  the STEP IFC loading route. Properties and Pset hydration passed.
- Packaged OLED smoke: 23 checks passed, zero page errors. Settings, reload,
  light/OLED switching, all seven scrolling surfaces and real IFC import
  passed. No white chrome surfaces remained in the loaded-model view.
- The public revision fixture still reports the existing EPSG:32760
  reprojection warning when federated. It loads in its own local frame;
  this run does not establish correct real-world federation alignment.
  The same warning appears in earlier native packaged smoke reports.

`OLED_PACKAGED=1 node desktop/oled-theme-smoke.mjs` checks embedded assets.
Both smoke runners accept `SMOKE_EXE` to verify the saved release copy.
The native Rust implementation was unchanged by this build.
