# Historical IFC Viewer 1.0 package audit

Build date: 2026-08-31 (Asia/Bangkok)

## Artifact

- File: `dist\IFC Viewer 1.0.exe`
- Size: 67,169,634 bytes (64.06 MiB)
- SHA-256: `1E2B59918BCD5B2BB8D2E7C65C1287BD7BAE5B26C872D784F160C114BBE5BD22`
- Authenticode: not signed

## Verified

- Python regression: 93/93 tests passed.
- Frontend behavior: 6/6 tests passed.
- Svelte validation: 0 errors and 0 warnings.
- Frontend production build completed successfully.
- PyInstaller build completed successfully with Python 3.14.7 and PyInstaller 6.22.2.
- Packaged health endpoint reported application version `1.0`.
- Packaged root page, fragment worker, and WASM assets returned HTTP 200.
- Packaged OpenAPI schema contained no `/auth` endpoint.
- PyInstaller build manifests contained no `license_gate`, `api_dependencies`,
  `ifc_auth`, or `AuthDialog` module.
- A real window-close message stopped all processes created by the packaged app;
  the log ended with `server_stopped` and `app_stopped`, with no forced stop.

## Scope notes

The application license gate, login UI, auth endpoints, auth dependencies, and
legacy license/auth packaging switches were removed. Third-party license notices
inside vendored JavaScript remain because they are legal attribution for bundled
dependencies, not application license enforcement.

This build audit does not repeat the manual real-IFC, Excel, or IDEA integration
checks listed in `packaging\RELEASE.md`.

This report describes the earlier 1.0 executable. It does not certify the current
1.0.0 source release.
