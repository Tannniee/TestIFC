# Native Colorizer validation — 16 October 2026

Candidate: `release/10.3.0-native-colorizer-20261016-r2/IFC-Lite.exe`.
SHA-256: `b653034e3fe8e6e041153563ac633735abefa885ba669796e49c98a12dd913f6`.
Built from the existing local working tree on `codex/desktop-v10.3.0`, based on
`471284f476d64a659ae607eeec2115ca3afcb9fe`. This checkout already contained
uncommitted native/renderer/server work; the build includes that work.
No commit, push or GitHub workflow was triggered.

## Workflow

Load an IFC → **Author → Model → Colorizer → Prepare model** →
**Paint whole model gray** → tick a section → **Paint selected groups** →
**Export coloured IFC**. Use the storey chip's **Storeys above → Show all**
to see the whole building while the Model workspace is active.

The panel owns a draft and local undo/redo. Closing it discards its preview;
its explicit export saves the colours to a new complete IFC. Existing viewer
edits are applied before grouping and colouring. Hidden objects are included.
The Rust core owns discovery, representation ownership and STEP edits. Native
transport uploads/downloads in bounded 2 MiB packets. No Python or IfcOpenShell
is added to the app runtime. See [the user guide](../docs/guide/colorizer.md).

## Actual packaged WebView2 run

Input: `F:\Steel\VBA\IFC COLO\hangarvd_f10_ tan base_f01_colored.ifc`.
Its SHA-256 remains
`df595b8d150b09dabbc48e21f6efd1b26a0f35ab07636a02d0b51896b94894a2`.

The probe used an isolated profile, actual file input and ribbon/panel clicks.
It prepared 75 groups / 14,509 physical surface products, painted gray, painted
`PIPE-267.4X8` red, checked undo/redo, clicked export, and reopened the resulting
IFC through the native engine. The generated download Blob was captured at the
download anchor, rather than confirming an operating-system save dialog.

- 1,968 red products and 12,541 gray products.
- Source-less viewer store stayed at zero source bytes before and after prepare.
- Reopened flat meshes: 608 red + 3,960 gray, with 4,568 flat meshes before/after.
  These are flat-mesh counts, not the full product count: native instanced
  geometry is carried separately.
- No WebView2 page errors. The existing source-less `UnitExtractor` warning
  about reading `IfcProject` was recorded; this is not an all-console-clean run.
- A separate preview run used **Show all** and captured the full structure.

Evidence: [`report.json`](../research/colorizer-20261015/native-ui/report.json),
[full preview](../research/colorizer-20261015/native-preview/04-selected-group.png).
The original failed UI probe caught missing ribbon-to-panel routing; that path
was fixed and covered by a mounted control test before building r2.

## Independent readback of the UI download

IfcOpenShell 0.8.5 was used only as an independent test oracle:

- Read all 14,509 Body items: exactly 1,968 red and 12,541 gray, opaque.
- All 184,677 non-presentation records retained their content and IDs.
- 12 geometry samples (six red/six gray): world vertices agree within absolute
  tolerance `1e-10`; triangle indices identical; material colours correct.
- Download: 11,874,073 bytes; SHA-256
  `a166ee0fc766cc0f8c7134356b86cffa8137604fab0d23cbde61d92e8b63af8b`.

See [`oracle.json`](../research/colorizer-20261015/native-ui/oracle.json).
This is not full-model tessellation parity or a full schema-validation claim.

## Automated checks and boundaries

- Root Turbo typecheck passed, including the 3,260-file test-coverage audit.
- Root Turbo viewer Colorizer shard: eight behavioral tests, including actual
  ribbon control routing, export of hidden objects in a federation, opaque
  preview versus export transparency, cancellation, stale source, chunk limits,
  incomplete downloads and overlapping exports.
- Rust Colorizer: nine tests, including shared map isolation, IFC2X3 rendering,
  indexed maps, cycles, schema attributes and property/type/material/storey groups.
- Native session: two tests, including existing edits and complete STEP streaming.
- Export and native desktop Clippy passed with `--all-targets -- -D warnings`.
- Colorizer lint, module-size, source-assertion, i18n and reference-walk checks
  passed for this change. The whole JSX accessibility ratchet still reports
  three warnings in the untouched `ViewCube.tsx`.
- The broader export library suite had 585 passing / seven failing tests in
  quantity/rebar tests. Those tests patch fixture text using LF-only delimiters;
  the local fixture content is CRLF. The Colorizer change does not alter those
  modules or fixtures. This broader suite is not reported green.
- Whole-workspace Clippy fails on three existing server dead-code diagnostics
  (`extract_data_model_scoped_cancellable`, `project_units`,
  `build_spatial_hierarchy`). No warnings were suppressed.

Preparation is opt-in and adds no work to the geometry load path. The local
preparation was about 1.4 seconds on this input; this is a smoke observation,
not a performance qualification. The reported download capture time includes
CDP byte serialization and must not be treated as a native export benchmark.
Large-model memory/latency and other IFC authoring tools remain unqualified.

Preview uses opaque colour overlays. Export transparency is written to IFC;
textured meshes can retain their pattern in preview and must be reviewed by
opening the exported file. Native source-less cache restores without an original
IFC must be reloaded. Browser-only Colorizer runtime is not implemented.

Prior release directories were not overwritten. The earlier SVD r2 EXE remains
at SHA-256 `61ee903b6539628571de2936d9274ad776943bea1ac8f9a21fc68b4997af620f`.
