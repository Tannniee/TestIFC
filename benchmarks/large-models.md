# Large-model benchmark

`run_large_models.mjs` exercises the current application with local IFC files from
`corpus.local.json`. The manifest, model paths, screenshots, cache, logs and result
JSON stay local under ignored paths. No IFC file is added to the repository.

On Windows, run with the project's Python environment and the Node runtime used
by the frontend:

```powershell
node benchmarks/run_large_models.mjs
```

Optional environment variables: `IFC_BENCH_OUTPUT` selects a separate results/cache
directory, `IFC_BENCH_MODELS` selects comma-separated manifest IDs, and
`IFC_BENCH_PORT` selects the backend port (frontend uses the next port).
`IFC_BENCH_SEMANTIC_TIMEOUT_MS` controls the wait after tool checks (default 20
minutes; the PVF baseline needed about 10.3 minutes at this stage). The default
ports are 8140/8141. The runner starts its own processes and shuts them down after
the run. It does not attach to the user's browser or desktop application.
Use a fresh output directory for each run; existing resource samples are rejected.
The default output directory includes a timestamp.

The benchmark uses Chromium headless with Direct3D11. The actual WebGL renderer
is recorded per model; verify it names the intended GPU before interpreting frame
timings. A SwiftShader result measures software rendering and must be identified
separately. Viewport size is 1440 × 900 at device scale 1.

After page navigation, the runner disables Playwright's CDP Network observers.
Otherwise large binary fragment POST bodies can be serialized into DevTools strings,
inflate the monitor's memory measurements, and exceed Node's string limit. This
does not disable the application's HTTP traffic. This adapter uses guarded
Playwright 1.62 internals because a public `newCDPSession()` controls a different
session. Recheck the adapter when upgrading Playwright; an unsupported layout
fails explicitly instead of silently producing contaminated numbers.

For each model, the runner measures first open, navigation, selection, an edge
measurement attempt, a section plane through the model bounds, semantic readiness,
cache reopen, navigation after reopen, and unload. Model loads are sequential to
avoid contamination from another benchmark. Navigation uses Playwright mouse input.
Section setup and tool selection use the application's methods; this is not a
manual validation of every toolbar or section-picking workflow.

## Meaning and limits of the measurements

- `completedMs`: the application's geometry-ready milestone. It is not a guarantee
  that every subsequent frame is smooth or every semantic query is available.
- `firstModelRenderMs`: first renderer submission with the current model attached.
  A model can initially be outside the camera view, so this is not a pixel-level
  measurement of the first visible geometry.
- `frames`: requestAnimationFrame intervals, separated by load/navigation phase.
  p95/p99/max intervals and intervals above 50 ms reveal stalls. These are frame
  scheduling measurements, not GPU timing queries.
- `inputToRender`: event timestamp to the next completed Three.js render call.
  This is a response proxy; it does not include physical mouse or monitor latency.
- `longTasks`: main-thread tasks exceeding 50 ms, via PerformanceObserver.
- `selectionResponseMs`: click to observed selection callback, polled every 100 ms.
  A no-hit result means no element was selected by the sampled clicks, not that
  the selection feature is broken. Edge measurement is likewise an attempt.
- `resources.jsonl`: one-second samples of the runner's process tree. Private bytes
  are committed process memory, not physical RAM. The sum of working sets includes
  shared pages more than once. `availableBytes` is system-wide available physical
  RAM. CPU is reported as core equivalents; divide by the machine's logical CPU
  count to obtain a fraction of total CPU capacity.
- `renderer.info.memory`: Three.js geometry/texture counts, not GPU memory bytes.
  A post-unload snapshot alone cannot establish the absence of long-session leaks.

The monitor excludes its own process. Vite and the orchestration process remain
in the measured tree; these are development-source measurements, not packaged EXE
measurements. The runner stops a model attempt if available RAM falls below 6 GiB,
the UI does not respond within 45 seconds, or loading exceeds 20 minutes.

Keep failures and their last completed stages in the report. Do not substitute
backend index completion for frontend geometry readiness.

To summarize a completed run, execute
`python benchmarks/summarize_large_models.py <result-directory>` on the same host.
It also reports resource sample gaps, semantic/geometry hash agreement and
post-unload geometry counts. `passed` means the scripted sequence completed;
inspect frame intervals and selection/measurement fields separately.
`semanticWaitObservedSeconds` is the sampled waiting phase after navigation and
tool checks. It is not total index-build time, because indexing overlaps loading
and interaction. A value of zero means no waiting sample was captured.

`python benchmarks/probe_index_read_concurrency.py` independently checks whether
hot-index reads remain available during a large cold write. It creates only a
temporary database with synthetic data. A `readError` in its JSON is a detected
concurrency problem, even though the diagnostic script itself exits normally.

References: [Microsoft process memory counters](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex),
[MDN long tasks](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming),
[Playwright browser launch](https://playwright.dev/docs/api/class-browsertype#browser-type-launch).
