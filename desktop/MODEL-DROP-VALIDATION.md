# Add and replace drop targets

When a scene is loaded, the window file-drop overlay shows two stacked cards.
The upper card adds models to the existing scene. The lower card replaces
**all current models** with the new file or new group of files. Only a drop
inside the lower card selects replacement; drops elsewhere keep adding.
The active card highlights without resizing or intercepting the window's
drag events.

Drop coordinates and intent are captured synchronously, before the overlay
unmounts or file handles/bundles are resolved. Both choices use the existing
bundle preparation queue and canonical primary/federated loaders. Empty,
unsupported and broken bundle inputs do not clear the scene. Replacement
resets viewer state and uses the existing full federation teardown, including
its model/global-ID cleanup. This does not add rollback for a parse error
after replacement has begun.

## Validation

- Root Turbo viewer typecheck: 49 tasks passed.
- Targeted viewer test shards: 32 tests passed, zero failures, including nine
  new routing/window-event tests, existing window drop behavior, bundle
  preparation and drag overlay state. One unrelated relationship test shares
  a shard. DOM loader tests prove routing and refusal, not geometry parsing.
- Headless Edge with synthetic HTML drag/drop on the desktop frontend development server: a real IFC
  is loaded, the upper card adds another while retaining its model ID, the
  lower card replaces both with one new model, and another replacement loads
  a new two-model federation. All resulting models contain 14 rendered meshes;
  no page errors. This browser run uses WASM and does not validate native Rust
  or a new EXE. Both light and Black OLED appearances were inspected.
- The sample contains EPSG:32760 metadata and triggers the existing federation
  reprojection warning when duplicated. The drop tests verify loading and
  replacement, not geographic alignment accuracy.
- Module-size ratchet, focused lint and diff whitespace checks pass.

Screenshots and JSON results are local ignored artifacts in `desktop/reports/`.
`desktop/model-drop-smoke.mjs` exports the same browser acceptance procedure
for later packaged verification. No EXE was rebuilt for this feature.

## Native event regression (2026-10-06)

The saved `10.3.0-native-fixes-b13725a` EXE reproduced the user's report:
Add retained the original, but Replace appended a third model. A trusted
Chromium drop committed the capture handler's React update before the window
bubble handler read the lower card's rectangle. The card was already gone,
so its missing rectangle selected the default Add action. The earlier
synthetic drag/drop procedure passed against this broken EXE; that result
did not cover native event ordering.

The hook now resolves Add/Replace synchronously in capture, before resetting
drag depth and closing the overlay. The bubble callback receives the captured
action and routes it only when no child zone claimed the drop. Correct routing
therefore does not depend on overlay lifetime or timer ordering. Provisional
dragover cleanup waits until the next task so a window-owned hover can retain
its highlight; unmount cancels its pending timer.

`desktop/model-drop-smoke.mjs` now uses `Input.dispatchDragEvent` with local
file paths, asserts `isTrusted`, checks that the chosen target is visible before dropping,
and checks final model names, counts, mesh presence, and original ID removal.
Against the current frontend served inside the saved WebView2 native host:

- Add: original retained, two loaded models.
- Replace: both old models removed, one replacement loaded.
- Replace a batch: prior model removed, two new models loaded.
- Each model contains 14 meshes; no page errors.
- Two consecutive fresh native host runs pass all three trusted-drop cases.
  Every resulting model reports `loadPath: native`.
- The 12 overlay/routing tests and 10 existing window-drop tests pass,
  including a React discrete-priority capture flush and a child-owned drop.

This verifies the modified frontend in a real desktop native host. The saved
EXE itself has not been repackaged with these changes. The duplicated sample
still triggers the existing federation CRS reprojection warning; these checks
do not establish GIS alignment correctness.
