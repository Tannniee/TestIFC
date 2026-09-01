# Fragment metadata A/B test

Test all three profiles against the same IFC corpus and browser environment:

- `?fragmentProfile=full`: all attributes and all relations. This remains the default.
- `?fragmentProfile=attributes`: all attributes and default relations.
- `?fragmentProfile=minimum`: the importer defaults.

Each profile has a separate versioned fragment cache key. Delete only the relevant
cached fragment, or use a new model hash, when measuring cold conversion. Reload the
same profile to measure a cache hit.

The app emits an `ifc-fragment-metrics` browser event after geometry becomes ready.
Collect it before opening the model:

```js
window.addEventListener("ifc-fragment-metrics", ({ detail }) => console.table(detail));
```

Record conversion time, fragment size, fragment-load time, total geometry-ready
time, and process memory. Test raycast, highlight, GlobalId, identity fields, grid
elevation, materials, visibility, section planes, cached reload, inspector, and
takeoff synchronization. Keep a lighter profile only after every required behavior
passes and the measurements improve.

## Phase 3 gate decision

The repository contains no customer or project IFC corpus. Phase 3 therefore
keeps `full` as the production default. The lighter profiles remain diagnostic
options; neither one has enough real-model evidence to replace `full`.

The synthetic smoke fixture covers geometry, spatial containment, material,
Pset, QTO, GlobalId, and a named profile. Generate and benchmark it with:

```powershell
..\.venv\Scripts\python.exe .\generate_phase3_fixture.py
cd ..\frontend
node --expose-gc benchmarks\run-fragment-ab.mjs ..\test-fixtures\phase3-synthetic.ifc 5
```

On 2026-09-01, the five-run synthetic median produced:

| Profile | Fragment bytes | Median conversion |
| --- | ---: | ---: |
| `full` | 2,356 | 28.056 ms |
| `attributes` | 2,354 | 25.693 ms |
| `minimum` | 1,908 | 24.316 ms |

This tiny model shows that the runner and all profiles work. It cannot predict
large-model memory or prove inspector/takeoff parity. The gate is closed by
retaining `full`, not by promoting an unverified lighter profile.
