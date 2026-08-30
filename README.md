# IFC Viewer Alternative

This repository contains the maintained IFC Viewer application. It is an independent
desktop product built from the recovered codebase; the active source no longer uses
the original executable or extracted bytecode as a behavioral reference.

## Project layout

- `desktop/`: PyWebView desktop host and application startup.
- `src/`: FastAPI bridge, IFC services, takeoff, exports, and settings.
- `frontend/`: Svelte and Three.js viewer.
- `backend/reference_data/`: material reference data packaged with the app.
- `tests/`: source-level regression and contract tests.
- `packaging/`: historical packaging inputs retained for traceability.
- `vendor/`: native modules required by the packaged application.

The repository root is the only project root. Build scripts and tests resolve all
paths from this directory.

The backend keeps HTTP contracts in `src/api_contracts.py` and thread-safe bridge
state in `src/api_state.py`. Route groups live under `src/api_routes/`; `src/app.py`
only configures middleware, creates shared state, and composes the application.
`src/model_operations.py` owns model use cases that can serve HTTP or future desktop
adapters. Domain and IFC modules do not depend on FastAPI request objects.

## Environment

Create the Python environment and install the pinned dependencies:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

The frontend uses pnpm. `frontend\BuildFrontend.cmd` uses the bundled Codex Node and
pnpm runtimes when they are not already available in `PATH`.

## Validate

Run the Python suite:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v -s tests -p "test_*.py"
```

Check and build the frontend:

```powershell
.\frontend\BuildFrontend.cmd
```

## Run from source

Build the frontend once, then start the integrated desktop host:

```powershell
.\.venv\Scripts\python.exe .\desktop\main.py
```

Set `IFC_VIEWER_PORT` only when an isolated instance must run beside another copy.

## Package

`BuildExe.cmd` runs the Python tests, checks and builds the frontend, and creates one
PyInstaller executable:

```powershell
.\BuildExe.cmd
```

The executable is written to `dist\IFC Viewer 0.4.0 ahihi Fixed.exe`. The packaged
application uses `desktop\build_config.json`; keep that file as the single build-mode
configuration.

## Historical material

Recovery artifacts, extracted files, legacy parity tests, and older package specs are
retained outside the active source paths. They do not participate in normal testing or
packaging.
