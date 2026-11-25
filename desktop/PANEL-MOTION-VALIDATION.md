# Right-panel surfaces and clash navigation — 16 October 2026

Candidate: [IFC-Lite.exe](release/10.3.0-native-panel-motion-20261016-r2/IFC-Lite.exe).
SHA-256: `4f749a1f810c29b0213bedc9a2b9ad5a556c6edc03896d84faf654eeb5afc0ef`.
Checkout: `F:\Steel\VBA\IFC-Lite`, branch `codex/desktop-v10.3.0`, base commit
`471284f476d64a659ae607eeec2115ca3afcb9fe`, including the existing local native-host changes.
The earlier interaction and Colorizer releases remain intact.

## Change and cause

The stationary 3D stage places the scene behind the docks. Several panel bodies
relied on the old layout to hide that scene and had no background of their own.
The shared dock now supplies a permanent opaque backing layer, including in the
Colorful theme, whose panel tint is intentionally translucent. Content animates
above that layer; the backing layer never fades.

Right-panel content and nested tabs use a shared 320 ms eased horizontal entry,
replacing the 140 ms entry. The canvas keeps its size and position. Clash-region
and group framing share a 700 ms camera transition. Reduced-motion preferences
disable these transitions. BCF capture still waits for framing to finish.

## Packaged runtime evidence

The isolated WebView2 run opened the real source file
`F:/Steel/VBA/IFC COLO/hangarvd_f10_ tan base_f01_colored.ifc` through the file input.
The source SHA-256 remains
`df595b8d150b09dabbc48e21f6efd1b26a0f35ab07636a02d0b51896b94894a2`.
The harness closes only its own EXE and browser session.

| Check | Earlier interaction r2 EXE | This candidate |
| --- | --- | --- |
| Requested panel shells | All 13 had transparent backgrounds | All 13 opaque throughout the sampled switches |
| Content entry | 140 ms | 320 ms, 11–26 sampled intermediate frames per panel |
| Placement Local ↔ Georeference | Transparent backing in all four switches | Opaque in all four switches; 26 intermediate frames each |
| Blank panel area while the camera orbits | 4,216 of 73,953 pixels changed | Zero changed pixels |
| Light, Dark and Colorful panel areas while orbiting | Not measured separately | Zero changed pixels in each 73,953-pixel sample |
| Clash target arrival, within 0.5% of the final target | 440.025 ms | 700.015 ms; 73 distinct sampled camera poses |
| Rapid clash choices | Last requested region reached | Last requested region reached |

The 13 panels are Cloud Sources, Location Zones, Layer Stack, Load Report,
Changes, Costs, Measurements, Extensions, Environment, Point Cloud, Model
Inspector, Change Sets and Placement. Every sampled switch retained the same
canvas rectangle. Reduced-motion checks passed for both panel animation and
clash camera navigation. Quiet startup also passed. No page errors or console
warnings were captured in this isolated run.

The clash navigation fixtures use actual loaded products and three distinct
overlapping mesh AABB regions. The harness clicks the rendered Clash Detection
rows and measures the real camera. These fixtures test navigation, not the
correctness of clash detection. Cloud authentication and provider browsing were
not exercised. Pixel comparison covers blank Cloud Sources panel regions;
all other listed shells were checked during their transitions through runtime
styles and canvas measurements. This is not an FPS benchmark.

Evidence:

- [Runtime report](../research/colorizer-20261015/native-panel-motion-r2/report.json),
  [panel traces](../research/colorizer-20261015/native-panel-motion-r2/surfaces.json),
  [camera trace](../research/colorizer-20261015/native-panel-motion-r2/clash-transition.json),
  [pixel comparison](../research/colorizer-20261015/native-panel-motion-r2/pixel-oracle.json).
- [Cloud Sources screenshot](../research/colorizer-20261015/native-panel-motion-r2/sources.png)
  and [Placement screenshot](../research/colorizer-20261015/native-panel-motion-r2/placement.png).
- Harness: `research/colorizer-20261015/e2e-panel-surface.mjs` with
  `SMOKE_EXE=desktop/release/10.3.0-native-panel-motion-20261016-r2/IFC-Lite.exe`
  and `EVIDENCE_DIR=native-panel-motion-r2`. Baseline uses the prior interaction
  r2 EXE with `BASELINE=1`. Pixel oracle: `verify-panel-pixels.py`.

## Source and build checks

- Root Turbo typecheck passed: 109 tasks; all 3,260 test files covered.
- Root Turbo viewer test shards: clash group focus 29/29, clash capture 4/4,
  Placement 4/4. The group capture test checks that capture stays pending until
  the camera-framing promise resolves.
- Changed TypeScript files passed the targeted lint check. Diff whitespace check
  passed. Module-size check passed for 4,662 files; its merge-base comparison was
  skipped because this checkout has no merge base with `origin/main` or `main`.
- Native Vite frontend build and stable Cargo release embedding passed. No Rust
  source was changed for this panel fix; Rust engine tests were not rerun.
- The full viewer test suite was not rerun. Prior Colorizer export and interaction
  evidence remains in [INTERACTION-UX-VALIDATION.md](INTERACTION-UX-VALIDATION.md);
  the present run does not repeat those export assertions.
