# Local desktop interaction contract

These rules describe the customized desktop host in this folder. They supplement
the upstream viewer guidance; they do not describe an official upstream desktop
distribution.

## State ownership

- A docked, split, floating or popped-out panel body may unmount. Unsaved IFC
  colour work belongs to `ColorizerWorkspace`, above these hosts. Closing or
  inspecting another panel must not discard it or upload the source again.
- A new source or editing revision must invalidate stale asynchronous work. An
  unrelated federated load changing `loading` must not invalidate a prepared
  draft for an unchanged source.
- The renderer's global selection and the property panel's model-aware selection
  are separate channels. Replacing a group selection clears and replaces both.
- Use `usePanelControls` to determine whether a panel is open and to toggle it.
  `sidebarActivePanel` and individual visibility flags retain the last panel
  while the dock is collapsed. Neither alone describes what the user sees.

## Surfaces, motion and renderer lifetime

- The desktop scene occupies a fixed stage. Ribbon and hierarchy/sidebar docks
  cover it; they do not resize or reframe it. HUD controls move clear of docks.
- The sidebar owns an opaque backing layer. Only incoming content animates.
  Theme tints and nested tab fades must never expose geometry behind that layer.
- Right-panel content, analysis extensions and bottom-panel content share the
  same entry motion. Reduced-motion preferences disable the animation.
- Explicit side-by-side drawing changes the available scene width but preserves
  the live canvas, GPU device and camera. Keep the viewport at one React tree
  position; optional sibling panes must not turn it into another branch.
- A rapid sequence must settle on the last requested panel or camera target.
  BCF capture waits for camera framing to finish.

## Verification before delivering a candidate

1. Run root Turbo typecheck and relevant root Turbo tests. On Windows, the full
   viewer suite needs its existing `TEST_SHARD`/`TEST_SHARDS` contract to avoid
   the command-line length limit. Browser contrast tests default to Chrome;
   `IFCLITE_TEST_BROWSER_CHANNEL=msedge` explicitly uses an installed Edge.
2. Camera hook tests must advance the real camera's animation update when a
   render is requested. A no-op renderer cannot establish that a damped gesture
   moved or stopped correctly.
3. Run native bridge tests for native changes. A build alone does not establish
   correct model loading, gestures, export, or cleanup.
4. Finish root test builds before the native frontend build: Turbo's viewer
   build restores web assets into the same `apps/viewer/dist` directory. Build
   with the desktop Vite config and native flag, then embed that result in Cargo.
5. Copy the EXE to a new release folder and record its SHA-256. Run the packaged
   quality smoke against that exact file with a real STEP IFC. Keep older EXEs
   and the source IFC unchanged.

The repeatable packaged gate is `npm run test:quality` from `desktop`, after the
root dependencies are installed. For example, from a root PowerShell terminal:

```powershell
$env:SMOKE_EXE = 'desktop/release/<candidate>/IFC-Lite.exe'
$env:IFCLITE_AUDIT_MODEL = 'F:/path/to/model.ifc'
$env:IFCLITE_AUDIT_DIR = 'desktop/reports/quality-<candidate>'
node desktop/quality-smoke.mjs
```

It covers empty/loaded panels, toggling, rapid switches, Drawing side docking,
real mouse input, panel pixels in three themes, Colorizer lifetime and selection,
two-model federation, export while changing panels, and clearing all models.
Use a representative model whose geometry reaches behind the sampled blank
Cloud Sources panel region for a meaningful pixel comparison. Export validation
in this smoke uses an ordinary STEP IFC without external appearance resources;
portable textured archives need their separate export oracle.

The gate owns an isolated WebView2 profile and EXE child. It must close only those
resources and return a failure code for failed cases. Its report is evidence for
the named executable and input; it does not certify cloud authentication, every
IFC geometry algorithm, physical touch hardware, or large-model performance.
