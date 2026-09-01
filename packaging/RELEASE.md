# Release gate

Create the executable only after every gate below passes.

1. Run all Python tests from `tests/`.
2. Run `frontend\BuildFrontend.cmd`; require all frontend behavior tests to pass,
   zero Svelte errors and warnings, and a successful production build.
3. Run `pnpm run test:e2e` in `frontend`; require 20 lifecycle cycles to leave one
   canvas, one viewer, and heap growth within the tested threshold.
4. Exercise a real SAP2000, ETABS, and HANGAR IFC through the local HTTP bridge.
5. Verify cached IFC activation, fragment reuse, tree/search, element lookup,
   takeoff CSV, model takeoff, and IDEA TSV.
6. Open one takeoff in Excel and confirm the `Takeoff` sheet contains numeric rows.
7. Run `BuildExe.cmd` once.
8. Launch the resulting executable on an isolated port. Verify health,
   packaged SPA assets, graceful shutdown, and the structured desktop log.
9. Connect Playwright to packaged WebView2 over CDP and verify one viewer canvas
   plus local bridge access.

The WebView2/CDP step is advisory on GitHub-hosted runners because they do not
provide a supported interactive desktop session. Enforce step 9 against the
packaged executable on an interactive Windows release machine before distribution.

The active package name comes from `src/version.py`. The application has no license
gate, authentication endpoint, login UI, credential, or build-mode switch.

Current mass policy resolves authored weight, authored volume, supported analytic
geometry, Geometry Iterator mesh volume, and section-text fallback in that order.
Unsupported or conflicting evidence remains absent or ambiguous instead of
inventing a volume.
