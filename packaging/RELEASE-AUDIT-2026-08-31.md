# IFC Viewer 0.4.0 ahihi release audit

Release candidate: `dist/IFC Viewer 0.4.0 ahihi.exe`

- Size: 69,704,218 bytes
- SHA-256: `A86EE981A01972A0CAE16D231C48D8F5ED6536DD78B1960859792295859EF5EA`
- Auth mode: `public`; authentication and license enforcement are disabled.

## R1-R7 gates

- Python release suite: 98 passed.
- Frontend behavior suite: 6 passed.
- TypeScript and Svelte checks: 0 errors, 0 warnings.
- Frontend production build: passed.
- Desktop readiness routing, cache atomicity, blocking-route threadpool use,
  converter recovery, and API/ViewCube behavior have regression coverage.

## R8 real-data regression

The source bridge successfully activated and queried all three cached IFC files:

- SAP2000: `maisanh_f02_v8i.ifc`, IFC4, 211,987 bytes.
- ETABS: `TTHC-ETABS.ifc`, IFC2X3, 15,276,938 bytes.
- HANGAR: `HANGAR_FULL99_04.12.2025.ifc`, IFC2X3, 135,227,297 bytes.

For every file, activation, runtime state, tree, search, material data, fragments,
ExpressId/GlobalId lookup, selection takeoff, CSV, IDEA scan, and IDEA TSV passed.
The HANGAR tree response was 23,733,771 bytes; `/health` remained responsive while
that response was built.

The SAP2000 whole-model takeoff completed 198/198. Its CSV contained 40,485 bytes.
Excel opened `Book1` with a `Takeoff` sheet containing 207 rows, 9 columns, and 204
numeric cells.

## Packaged executable smoke

The exact release candidate started on isolated port 8151 and returned:

- `/health`: HTTP 200, app version `0.4.0 ahihi`.
- `/auth/status`: authenticated and valid, `enforced=false`, `authMode=public`.
- Packaged JS and CSS: HTTP 200.
- Fragments worker and WebIFC WASM: HTTP 200.
- Structured log: valid JSON Lines with `server_stopped` and `app_stopped`.

The Codex command environment did not expose the pywebview window handle, and the
Windows-control helper approval timed out. Therefore a physical click on the close
button was not observed in this audit. Server shutdown itself is covered by the
desktop lifecycle tests and the packaged process released its isolated listener.

## Packaging notes

PyInstaller reported optional-module warnings from IFC/OpenCascade tooling, including
Android, sequence, and parser helpers. None appeared in the exercised release paths;
the packaged runtime smoke above passed. The older derived executable and all source
IFC/cache inputs were preserved.
