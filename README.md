# IFC Viewer Alternative

This repository contains the maintained IFC Viewer application. It is an independent
desktop product built from the recovered codebase; the active source no longer uses
the original executable or extracted bytecode as a behavioral reference.

## Project layout

- `desktop/`: PyWebView platform adapters and the desktop composition root.
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
adapters. The IFC foundation is split into four services:

- `src/ifc_units.py`: unit resolution and quantity normalization.
- `src/model_cache.py`: persistent IFC, fragment, index, and store cache paths.
- `src/model_runtime.py`: active-model lifecycle, index preparation, and live IFC access.
- `src/ifc_elements.py`: semantic records and optional element geometry.

`src/ifc_service.py` remains a compatibility facade. Production modules import the
smaller services directly. Domain and IFC modules do not depend on FastAPI request
objects.

Application orchestration also stays outside the HTTP and bridge-state modules:

- `src/takeoff_service.py`: synchronous takeoff, Excel handoff, and background jobs.
- `src/member_scan_service.py`: IDEA scan execution and latest-result lifecycle.
- `src/fragment_service.py`: streamed fragment storage and cache lookup.
- `src/api_errors.py`: shared HTTP mapping for model-state failures.

`src/api_state.py` owns selection state only. Mass policy lives in `src/mass.py`;
wire serialization lives in `src/mass_wire.py`. Architecture tests enforce these
boundaries, and versioned golden fixtures protect takeoff exports.

The frontend follows the same composition boundary:

- `frontend/src/lib/app-shell.ts` owns settings, viewer lifecycle, and commands.
- `App.svelte` composes the rail, dialogs, inspector, and viewer workspace.
- `viewer.ts` coordinates the camera, selection and render-on-demand scheduler.
- `viewer-model-loader.ts` owns file reads, conversion, fragment models and
  backend preparation. Conversion workers are created on demand and terminated
  after completion, cancellation or failure.
- `viewcube-math.ts` owns the pure ViewCube geometry, naming, and orientation math.
- `api-contracts.ts` is the typed frontend endpoint manifest. Contract tests compare
  it with the backend OpenAPI document, and Vite derives its proxy prefixes from it.

Frontend architecture tests prevent `App.svelte` and the renderer from importing
HTTP or persistence adapters directly.

The desktop layer is split by platform concern:

- `desktop/main.py` only composes the window, bridges, logger, and server host.
- `desktop/server_host.py` owns port selection, SPA mounting, readiness, and graceful
  Uvicorn shutdown.
- `desktop/desktop_bridges.py` exposes the stable taskbar and settings JavaScript API.
- `desktop/platform_paths.py` resolves source, packaged, cache, and user-data paths.
- `desktop/logging_config.py` writes rotating structured logs to
  `%LOCALAPPDATA%\IFC Viewer\logs\desktop.jsonl`.

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

Check the frontend during refactoring without creating a package:

```powershell
cd frontend
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\svelte-check\bin\svelte-check --tsconfig .\tsconfig.json
```

## Performance baseline

The repository contains a repeatable backend benchmark contract under
`benchmarks/`. Copy `corpus.example.json` to `corpus.local.json`, point it at
sanitized or locally controlled IFC files, then run:

```powershell
.\.venv\Scripts\python.exe .\benchmarks\run_backend_baseline.py
```

The runner verifies optional SHA-256 expectations and records hashing, IFC open,
semantic-index preparation, and search timings as JSON under
`benchmarks/results/`. The local corpus and generated results are ignored by Git;
no private IFC model is committed to this repository.

For fragment metadata A/B testing, follow
`benchmarks/fragment-ab.md`. The `full` profile remains the default until the
lighter profiles pass the real-model feature matrix.

Semantic DB v2, facts-cache versioning, and take-off schema v6 are documented in
`benchmarks/phase4-5.md`.

Semantic DB v3 search, byte-aware cache retention, browser lifecycle E2E, and CI
are documented in `benchmarks/phase6.md`.

The cache keeps at most three model bundles and 10 GiB by default. Override the
limits with `IFC_CACHE_KEEP_MODELS` and `IFC_CACHE_MAX_BYTES`. Active, pinned,
uploading, and building bundles remain protected even when they exceed a limit.

## Run from source

Build the frontend once, then start the integrated desktop host:

```powershell
.\.venv\Scripts\python.exe .\desktop\main.py
```

Set `IFC_VIEWER_PORT` only when an isolated instance must run beside another copy.
The desktop keeps its bound socket through server startup, so an automatically
selected port cannot be taken between selection and startup.

Each desktop launch creates an internal API session. The viewer receives its
credential through the desktop bridge; API calls require `X-IFC-Session` and
validate loopback Host and browser Origin. Credentials are not written into the
frontend bundle, URLs, settings or logs.

For browser development, generate `IFC_API_SESSION_TOKEN` (at least 32 ASCII
characters) in the parent environment and pass the same value to Uvicorn and
Vite. Vite reads this server-only variable and injects the header for requests
from its own origin. Do not use a `VITE_` variable for the credential. The
integrated desktop generates and transfers its own session automatically.

`benchmarks/run_foundation_smoke.mjs` creates a temporary shared session for the
live backend and browser tests. `benchmarks/run_desktop_session_smoke.mjs` tests
the source desktop and built frontend with isolated settings and a real IFC;
neither command builds an executable. Render comparison against a Git revision
uses `benchmarks/run_render_navigation.mjs` and existing local fragment caches.

## Semantic progress and measurements

Semantic indexing reports its phase and record counts in the footer. If work
stops advancing, Retry cancels the owned worker and resumes committed cold-index
batches. Cold indexing uses SQLite WAL with one writer/checkpointer and short
read-only queries. Keep the model cache on a local filesystem.

For a fixed-distance measurement, pick the first point and type a distance.
The compact input stays at the bottom of the viewport; choose mm or m, then
press Enter or click a direction. Snap to the red X, green Y or blue Z axis
(either sign), or a second model point. Click the number to edit it; Escape
clears the fixed distance while retaining the first point.

## Package

`BuildExe.cmd` runs the Python tests, checks and builds the frontend, and creates one
PyInstaller executable:

```powershell
.\BuildExe.cmd
```

The executable name and Windows version metadata come from `APP_VERSION` in
`src\version.py`. Version 1.0.2 is written to `dist\IFC Viewer 1.0.2.exe`.
Release changes are recorded in `CHANGELOG.md`. The application requires no license,
account or sign-in; its internal API uses a per-launch session credential.
Follow `packaging\RELEASE.md` for the real-model and artifact
gates.

## Historical material

Recovery artifacts, extracted files, legacy parity tests, and older package specs are
retained outside the active source paths. They do not participate in normal testing or
packaging.
