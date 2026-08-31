# Release gate

Create the executable only after every gate below passes.

1. Run all Python tests from `tests/`.
2. Run `frontend\BuildFrontend.cmd`; require all frontend behavior tests to pass,
   zero Svelte errors and warnings, and a successful production build.
3. Exercise a real SAP2000, ETABS, and HANGAR IFC through the local HTTP bridge.
4. Verify cached IFC activation, fragment reuse, tree/search, element lookup,
   takeoff CSV, model takeoff, and IDEA TSV.
5. Verify the configured package auth mode. The active release is `public`:
   `/auth/status` must report `authenticated=true`, `valid=true`, and
   `enforced=false`; login must not be required.
6. Open one takeoff in Excel and confirm the `Takeoff` sheet contains numeric rows.
7. Run `BuildExe.cmd` once.
8. Launch the resulting executable on an isolated port. Verify health, auth,
   packaged SPA assets, graceful shutdown, and the structured desktop log.

The active package name comes from `src/version.py`. `desktop/build_config.json`
is the only package auth-mode input. Specs under `packaging/legacy/` are retained
for traceability and never participate in the active build.

The active spec still carries the native auth extension for compatibility with a
future OAuth build, but the public package does not call or enforce it.

Current mass policy resolves authored IFC weight first. Analytic mesh mass remains
unavailable for unsupported representations such as `IfcExtrudedAreaSolid` and
`IfcBooleanClippingResult`; the API reports this explicitly instead of inventing a
volume.
