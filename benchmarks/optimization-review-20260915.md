# Semantic index optimization

Implemented:

- Skip material density lookup when usable authored volume is absent; preserve zero volume.
- Fetch hot rows once per cold batch and write cold/FTS records with executemany.
- Preserve 128-record / 4 MiB / 0.5-second commit bounds, WAL, cancellation and resume.
- Retry Windows SQLITE_IOERR_TRUNCATE during crash recovery with fresh connections,
  at most six attempts and 300 ms total backoff. Other errors propagate immediately.
  Persistent truncate failures still propagate. No WAL files are deleted.

Validation before packaging:

- 177 Python tests passed in eight consecutive complete runs after the recovery change.
- Before/after logical fingerprints match for element, element_cold, element_fts,
  tree_edge and tree_root on all three IFC models (3272, 9278 and 180070 index rows).
- Fresh semantic-index observations: 0.967 -> 0.828 s (3.1 MB),
  6.204 -> 6.437 s (63.8 MB), 254.326 -> 244.642 s (304.2 MB).
- These are single observations, with overlapping benchmark activity on the large
  model. They establish parity, not a statistically reliable speedup. They do not
  measure geometry conversion or packaged first-visible time.

Raw local evidence: results/semantic-before.json and results/semantic-after.json.
The comparison runner uses isolated temporary caches and closes SQLite before cleanup.

Final UI and package validation:

- Fixed a real footer overlap that prevented clicking Retry after rollback conflict.
  The semantic status area now reserves 120 CSS pixels for its text and button.
- E2E used a real 3.1 MB IFC plus isolated enriched/identity variants. The full run
  passed 37 cases; navigation initially failed on floating-point exact equality.
  After using a 1e-10 coordinate tolerance, its complete 3-test suite passed.
  No cases were skipped in the full run. All 38 scenarios have passing evidence
  across these runs, rather than a single final all-green suite.
- Test probes use integer click pixels, wait for visible section handles, and read
  duplicate/missing GUID IDs from the generated fixture sidecar.
- Final BuildExe.cmd passed 177 Python tests, 35 frontend tests, zero Svelte
  errors/warnings, Vite and PyInstaller.
- Final packaged WebView2 loaded real IFC geometry, reached hot/cold index ready,
  and closed gracefully with exit 0. No packaged process remained.
- A pywebview cleanup warning reported an already-missing temporary directory;
  it did not prevent graceful exit.
- Artifact: BUILD RELEASE/IFC Viewer 1.0.3.exe, 67329029 bytes.
- SHA256: 74C518F988CF7465189D3632406BCB41BF00287A3C945DE3C3C160B406D8181A.
- Previous EXE preserved under BUILD RELEASE/archive.

Pending work:

- Repeat interleaved baseline/candidate measurements on an idle machine, including
  peak process memory and separate hot/cold timings.
- Evaluate metadata profiles against complete Browser/Properties/identity fixtures.
- Prototype overlapping upload/conversion with cancellation and rollback ownership.
- Type/material caching must preserve occurrence-level overrides and IFC2X3 behavior;
  merging Pset and Qto by name alone can lose distinct definitions and is not enabled.
- Native conversion and progressive geometry remain separate experiments.
