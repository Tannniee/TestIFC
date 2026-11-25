- [x] Freeze full custom r7 source in isolated upgrade worktree.
- [x] Import all upstream package sources and support/dependency contracts.
- [x] Reconcile Rust/Nhip/native compatibility and compile/test.
- [x] Reconcile viewer functions with custom UI/navigation/Colorizer/Box.
- [ ] Align versions and package catalogue; regenerate bindings/snapshots/docs.
- [ ] Run root TS/Rust/desktop checks and address failures without weakened tests.
- [ ] Build and qualify exact native EXE, model/geometry/export/UI/perf.
- [ ] Deliver separate release, provenance and top-level latest shortcut.

Native desktop test suite passed: 37 tests, including geometry transport, precision, semantic cancellation and project units. Root Rust, WASM, viewer and broader package qualification remain in progress; no release EXE or latest shortcut changed.

Checkpoint 2026-11-06:
- Root Rust workspace: 7689 passed, 0 failed, 48 ignored; pinned Clippy green.
- Module-size targeted tests8/8; API unchanged snapshot60packages113surfaces10379exports; no raised module budgets.
- Root lint12003files green; production dependency audit701dependencies0vulnerabilities.
- Source WASM final default/retained/diff build completed.
- Candidate desktop37tests and hangar15runtime checks passed; independent IfcOpenShell0.8.5 verified14509grayproducts,184677unchanged non-presentation records,6geometrysamples.
- Actual Box pointer suite passed. Measurement0.42449m endpoints projected0.37668px was wrongly rejected; fixed world-space equality, focused27/27green.
- Animation focus59/59 and native hierarchy/registry focus10/10green.
- Full viewer16shards ran; unresolved failures catalogued in research/upstream-update-20261105/viewer-failures.json.386committedIFCfixtures restored to exact upstreamLF; rerun failed files with IFCLITE_TEST_BROWSER_CHANNEL=msedge after finalbuild. Some default-navigation tests need explicit default preset; Gaussian path and direct-loadWindowsURL fixes applied, not rerun yet.
- Final EXE rebuild started in desktop-build-final.log. Must re-run exact final EXE navigation/Box/hangar, sourceWASMboundarytests and targetedviewerfailures; Nhip67geometry capture/oracle and interleavedperf still outstanding.
- Native probe selected source frame access fixed to result.frame.baked_basis; rebuild probe before use. capture-model.mjs is ready but not run.
- Old EXEs and top-level latest shortcut unchanged; no final release folder, commit, push or deployment yet.

Delivery 2026-11-06: rebuilt EXE12.2.0 in original root desktop/release/12.2.0-upstream-20261106-r1; top-level IFC-Lite - Latest.lnk verified. Exact delivered EXE isolated native navigation suite passed and hangar quality audit passed all cases with no page errors. Combined Box then navigation pointer-selection assertion remains unresolved and is recorded in build-info.json; broader qualification remains incomplete. Previous r7 hash verified unchanged.
