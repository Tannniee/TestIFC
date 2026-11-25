# App quality audit — 17 October 2026

The audit found shared state/lifetime defects beyond the previously repaired
panel transparency. The repairs have source regression coverage and passed
packaged acceptance on the real hangar IFC.

## Scope and stopping rule

Audit the current customized Windows desktop app, branch
`codex/desktop-v10.3.0`, base `471284f476d64a659ae607eeec2115ca3afcb9fe`.
Start from the delivered panel-motion r2 EXE, SHA-256
`4f749a1f810c29b0213bedc9a2b9ad5a556c6edc03896d84faf654eeb5afc0ef`.
Preserve the existing dirty checkout, original IFC sources, previous releases
and user-owned processes.

Check shared panel hosts and their empty/loaded/split/detached/rapid-switch
states; ribbon and viewport interaction; selection and federation identity;
section transitions and cancellation; Colorizer draft/export lifetime and
asynchronous races; and native load/error/cleanup boundaries. Review the source
and run the relevant existing tests plus packaged regression scenarios on a
real IFC model. Record each confirmed defect with a reproducer and disposition.

Finish when the scenario matrix is executed, confirmed regressions in these
paths are fixed and guarded, or a remaining issue has a specific limitation and
reproducer. This is not a revalidation of every Rust geometry algorithm or a
certification of external cloud providers. No dependency upgrades, publication,
or unrelated refactoring are part of this audit.

## Confirmed findings and repairs

| Finding | Reproducer and consequence | Repair and regression evidence |
| --- | --- | --- |
| Unsaved Colorizer work belonged to a panel mount | Paint gray, open Properties, return; or split/rejoin the dock. The delivered r2 lost all 14,509 painted products. | One lazily activated `ColorizerWorkspace` owns source job, draft, undo and export above the panel hosts. `ColorizerWorkspace.test.tsx` tests remount, undo/redo, hidden export and teardown. |
| Unrelated loads invalidated an unchanged colour source | Add a second model while a draft exists; generic `loading` transitions discarded it. | Preparation and invalidation follow the actual source/revision. Schedule validation is scoped to the source owning that schedule. Loading-flag and unrelated-schedule tests cover this. Real source replacement still invalidates stale work. |
| Group checks diverged from the visible selection | Check a group, then clear or replace the 3D selection. Its checkbox remained selected. Deselecting also left semantic property selection behind. | Observe renderer selection ownership and replace/clear both canonical selection channels. Regression checks semantic references, renderer IDs and external clearing. |
| Closed panels retained an active toolbar latch | Close Measurements List or Change Sets; the launcher still appeared pressed. Measurements as the secondary split pane also closed the wrong state. | Both entry points use shared `usePanelControls` open/toggle semantics, including collapsed, split and detached states. Mounted toolbar tests cover these paths. |
| Drawing docking destroyed the live renderer | Open Drawing, dock beside the scene: the old main canvas became disconnected. | Keep the viewport at a stable React tree position inside `DrawingWorkspaceSplit`; only optional siblings change. A DOM mount test checks four flips preserve exactly one live canvas. |
| Extension switching reused another extension's local state and missed shared motion | Two registered analysis extensions using the same component inherited each other's counter state. Bottom content lacked the shared entry surface. | Key extension bodies by identity; use the shared surface and entry animation for analysis and bottom hosts. Mounted extension test proves the second extension starts with its own state. |
| Consecutive ribbon double-click pairs used an outdated captured state | Rapid click sequences may continue with click counts 3/4 and 5/6, instead of restarting at 1/2. | Capture pre-click state on every odd click count. Ribbon DOM event tests include consecutive pairs. This particular count sequence is synthetic event evidence; packaged ordinary double-clicks are checked separately. |

The prior panel backing, 320 ms content motion, reduced-motion behavior and
700 ms clash framing remain in place and are included in packaged acceptance.
No geometry algorithm, new dependency or external publication was added by this
audit. Existing unrelated worktree changes are retained.

## Source and native checks

Evidence lives under `research/app-audit-20261016/`; that folder retains its
original date because the work began on 16 October.

| Check | Result | Evidence |
| --- | --- | --- |
| Full Viewer suite through root Turbo, 12 supported Windows shards | 13,817 tests: 13,780 pass, 37 conditional skips, zero failures/cancellations | `viewer-suite.json`, `viewer-suite-totals.json`, `viewer-shard-0.log` through `viewer-shard-11.log` |
| Final Colorizer workspace checks after the last source/schedule changes | 7/7 pass | `colorizer-final-seven.log` |
| Final Colorizer panel/transport/selection checks | 17/17 pass | `colorizer-panel-final.log` |
| Root Turbo typecheck, including test sources | 109 tasks pass; all 3,263 test files in a typecheck program | `typecheck-final-seven.log` |
| Renderer and spatial suites through root Turbo | Renderer: 1,995 pass, 2 conditional skips; spatial: 66 pass | `renderer-spatial-tests.log` |
| Native desktop Rust tests | 32 pass | `native-tests-before.log` |
| Native desktop Rust clippy, all targets, warnings denied | Pass | `native-clippy.log` |
| Targeted production-file lint | Pass, no reported diagnostics | `lint-final.log` |
| Test wiring, source-text assertion guard, i18n literal guard | Pass | `test-wiring.log`, `source-text-guard.log`, `i18n-guard.log` |
| Module size | No new file over 400 lines; merge-base allowlist audit unavailable in this checkout | `module-size-final.log` |

The full suite preceded the final two workspace cases; those and the final
source changes were checked again with the targeted run and full typecheck.
These counts are not added together as if they were distinct test cases.
Some mounted Colorizer tests emit React `act` warnings; their assertions pass.

Root `pnpm lint` is **not green**: the changeset guard invokes `pnpm` through
`execFileSync`, which fails with `ENOENT` for the Windows command shim before
the later gates run (`lint-all.log`). The checks listed above were run
separately. The unchanged ViewCube also has three existing `prefer-tag-over-role`
warnings (`viewcube-lint.log`). No suppressions or lowered thresholds were added.

Older test expectations which explicitly required reopening Properties were
updated to the user's requested collapse behavior. Camera hook fixtures now
advance the real camera on render requests rather than inspecting a damped
camera before it updates. Model rotation fixtures provide the current compact
instance-bounds API. These retain behavior assertions; no tests were skipped to
make the suite pass. Windows contrast/dynamic-import helpers now handle CRLF,
file URLs and an explicitly selected installed Edge channel.

## Packaged acceptance

Candidate: [IFC-Lite.exe](release/10.3.0-native-quality-audit-20261017/IFC-Lite.exe),
SHA-256 `1b9a8879c4ff556324cf3aaa459b58d2fcd8f1d03fda22579bd861e98fbc1d4b`.
Built with the native desktop frontend flag and embedded by the release Cargo
build (`native-frontend-final.log`, `native-exe-final.log`).

Input: `F:/Steel/VBA/IFC COLO/hangarvd_f10_ tan base_f01_colored.ifc`, SHA-256
`df595b8d150b09dabbc48e21f6efd1b26a0f35ab07636a02d0b51896b94894a2`.
Native load produced 1,917,264 vertices and 1,681,800 triangles.

- The permanent quality gate passed **14/14 scenario groups**, with zero page
  errors: 22 side panels empty/loaded, eight bottom panels, repeated and rapid
  toggles, Measurements split/latch, live Drawing canvas, real mouse drag,
  panel pixels in three themes, Colorizer remount/split/selection, two-model
  federation, leaving during Save as, and closing all models. The draft kept
  all 14,509 products while hidden and after returning. In federation, 1,968
  selected group IDs all resolved to the original source owner. Save as was
  still busy when the test left the panel and subsequently delivered a complete
  11,873,913-byte IFC. Evidence: `quality-after/report.json`.
- The previous interaction acceptance passed **53 assertions**, including
  **44 animated dock/ribbon transitions with zero projected-point drift**,
  ordinary repeated double-clicks, Plan/3D, group highlighting, grouping changes,
  PAN/orbit/multiple-selection mode changes, Ctrl+click selection of five
  different members, right-click colour, shared undo, Box-to-plane framing and
  native reopening of the saved IFC. The section transition had 42 distinct
  intermediate camera poses. Evidence:
  `research/colorizer-20261015/native-quality-audit-20261017/report.json` and
  `interactions-after.log`. Reopening retained the same native geometry totals.
- Panel/Placement/clash acceptance passed **10 assertions**, including 13
  requested surfaces opaque throughout their 320 ms content motion, four
  Local/Georeference switches without background exposure, clash row framing
  settling at approximately 700 ms with 168 distinct camera poses, rapid clash
  changes reaching the last target, and reduced motion disabling transitions.
  The pixel oracle found **zero changed pixels out of 166,804 sampled pixels**
  while the camera moved, for each of default/light/dark/colorful captures.
  Evidence: `research/colorizer-20261015/native-quality-panels-20261017/report.json`,
  `pixel-oracle.json` in that folder, and `panels-after.log`.

Independent export checks used **IfcOpenShell 0.8.5 only as a test oracle**;
it is not an application runtime dependency. Both the all-gray download and
the five-selected download passed all 14,509 Body-colour checks. The latter
contained exactly five red and 14,504 gray products. All 184,677 records outside
the presentation classes retained their IDs and exact values in each export.
World-coordinate vertices and triangle faces matched on six sampled gray
products in the gray export, and eleven sampled products in the five-selected
export. This is sampled independent geometry evidence, not full world-mesh
parity for all 14,509 products. The original input hash stayed unchanged.
Evidence: `quality-after/audit-gray-oracle.json` and
`research/colorizer-20261015/native-quality-audit-20261017/five-selection-oracle.json`.

The independent IFC oracle uses the existing Python environment at
`F:/Steel/VBA/IFC COLO/recovered_source/.venv/Scripts/python.exe`; the pixel
oracle uses the default Python 3.14 environment with Pillow. Their installed
packages differ. The initial wrong-interpreter attempts were tooling errors,
corrected without adding packages to the app or changing the exports.

The repeatable gate is `desktop/quality-smoke.mjs`, invoked by
`desktop/package.json`'s `test:quality`. Its contract and exact invocation are
in [UI-QUALITY-CONTRACT.md](UI-QUALITY-CONTRACT.md). Each run used an isolated
WebView2 profile and closed its own EXE child.

The previous panel-motion r2 and interaction r2 executable hashes were checked
again and remain unchanged. Release metadata in `provenance.json` records the
candidate executable, dirty checkout source fingerprint, input, checks and
preserved artifacts. No commit, push or CI run was initiated.

Baseline evidence: `runtime-before-compact/report.json` and
`quality-before/report.json` reproduce the draft, latch, selection and renderer
lifetime defects against the delivered panel-motion r2. The first research
harness hit an assertion-formatting overflow while comparing large arrays;
the first permanent-gate baseline later hit an unhandled download timeout
following an earlier failed paint case. Both harness faults were repaired.
Neither is counted as an application crash or proof of an export defect.

## Scope limits and continuing delivery rule

- This is the customized local Tauri host, not a first-party upstream desktop.
- Colorizer owns one source draft at a time. Explicitly choosing a different
  source or changing its editing revision resets that draft; this audit does
  not implement separate retained drafts for every source model.
- Cloud/provider authentication and remote datasets need real credentials and
  were not exercised; panel empty/loaded surfaces are covered.
- Physical touch and SpaceMouse hardware were not tested. Touch/camera logic
  has automated coverage; that does not establish physical device behavior.
- No new SVD heavy-model FPS profile or exhaustive Rust geometry-engine audit
  was performed. Native bridge tests and sampled export geometry checks have
  narrower claims.
- Textured portable IFC archives retain their separate export contract. The
  packaged export oracle here uses the named ordinary STEP IFC model.

Before the next candidate is delivered, run the shared contract's source checks
and packaged quality gate against its exact EXE, record the input/hash and
retain the report. A source build alone is insufficient evidence for visible
panel, gesture, selection or export behavior. This reduces regressions in the
tested defect classes; it is not a promise that no other bug can occur.
