# Home / isometric whole-scene fit

Home previously changed position, target, and up while retaining the old
orthographic half-height. Returning Home after zooming in therefore stayed
cropped; after zooming out it stayed tiny. Its legacy perspective standoff
also ignored viewport aspect. The default infrastructure policy deliberately
framed a local detail, rather than the whole scene.

The shared Home callback used by the ribbon and cube now asks for a whole-scene
SE isometric fit using the camera's complete scene bounds. The trimmed bounds
used by automatic loading/orbit anchoring can omit distant parts, so they are
only the fallback when no complete bounds are available.

The renderer reuses its corner-based zoom-extent calculation from that Home
direction, fitting both horizontal and vertical viewport dimensions. It sets
orthographic half-height when snapping and animates it together with position,
target, and up when transitioning. Perspective and orthographic modes remain
selectable; this action does not change the selected projection mode. The
automatic infrastructure detail policy remains available without `wholeScene`.

## Validation (2026-10-06)

- The saved b13725a EXE reproduced unchanged `orthoSize: 0.1` after Home.
- Five renderer regressions cover near/far orthographic zoom, narrow viewports,
  perspective corner fitting, animated scale, zero-duration scale application,
  and a whole-scene overview of an elongated federation. They project all eight
  bounding-box corners through the actual Camera matrices.
- Renderer suite: 1,972 tests pass, two existing tests skip, no failures.
- In the real saved WebView2 host with the current frontend and native backend,
  a two-model scene passes Home from orthographic sizes 0.1 and 100,000, then
  perspective and orthographic Home after narrowing the viewport. All eight
  projected scene corners lie within the canvas; no page errors.
  Two fresh native host runs pass these cases. The portrait metrics override
  stays attached through each check, with canvas width/height below 0.8.
- `F:\Working\IFC Temp\Architecture.ifc` also completes through native Rust
  with 321,675 meshes and 222,107 BIM entities. From orthographic sizes 0.1
  and 100,000, the actual Home button reaches the same fitted size, and all
  eight corners of its full scene bounds fit the 811.4 by 803 CSS-pixel canvas.
  The stadium is fully visible in both screenshots; no page errors. This
  verifies camera framing, not full geometry parity.
- Viewer and renderer root Turbo typecheck: 50 tasks pass. Focused lint, API
  surface, Changeset, and module-size checks pass without raising a budget.
- Documentation snippets: 428 compile across 100 documents. The Windows-only
  check adapter invokes the compiler JS entry and normalizes its listed path
  separators; compiler output is retained under `desktop/reports/`.

Reports and screenshots live in the ignored `desktop/reports/` folder. This
validates source changes hosted in WebView2, not a newly packaged executable.
