# Complete upstream package and viewer upgrade

User approved implementation on 2026-11-05, including every package and versions aligned to GitHub.
Source pin: main `2cf5d2fa7f7831aa8282c944d7a2a67fa3cf878e`.
Frozen custom r7 source: `8c065043` in this isolated worktree.

Keep native loading/IPC, Nhip geometry repairs, TestIFC navigation/cube/Box,
Colorizer/undo/Save as, persistent canvas, panel/themes and federation/GIS.
All published package versions and source imports follow the pin. Desktop/root
release becomes 12.2.0; viewer is 5.5.0; native engine is 28.2.0 with documented local repairs.
No public push, deployment, source-model writes, old-build removal, or whole-library distribution.

Implementation order: package/runtime contracts -> Rust/native bridge -> viewer
feature callers and preserved custom UI -> full checks -> packaged qualification.
Merge conflicts are reviewed per module; never treat a text merge as behavior evidence.
Use existing regressions to expose integration errors; add focused behavioral
regressions for adapter bugs. Root pnpm test/typecheck run through Turbo.

Acceptance: all 65 package sources/manifests imported with local adaptations recorded;
matching WASM build; native and root Rust tests/clippy; root TS tests/typecheck/lint;
real EXE regression tests and independent IFC oracle; interleaved perf qualification
for geometry/renderer; new release folder and top-level shortcut after qualification.
