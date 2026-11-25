# Core upgrade execution state

Active user request: implement the approved layered core upgrade, preserving the
custom native desktop, Colorizer, TestIFC navigation/section workflow, themes,
fixed-stage panels, federation/GIS, instancing and bounded CPU picking.

## Scope and source

- Original checkout, preserve: `F:/Steel/VBA/IFC-Lite`, branch
  `codex/desktop-v10.3.0`, HEAD `471284f476d64a659ae607eeec2115ca3afcb9fe`.
- Implementation checkout: `F:/Steel/VBA/IFC-Lite-Core104`, branch
  `codex/core-10.4.0-upgrade`.
- Full local dirty snapshot copied (592 files including research evidence).
  Source snapshot commit `0074241838dd52f456ac88c274700c09a9754cc6` excludes
  research/binaries. Fingerprints: `source-snapshot.json`.
- Approved upstream production pin:
  `61d209288c1b117d405628ead302d0ee700bd2a0`.
- Rust 20.4.0 / WASM 10.4.0 / parser 9.5.1 / geometry 7.8.1 /
  renderer 6.4.0 / data 6.2.0. Viewer UI remains the custom 4.0.0.
- Root private package version now 10.4.0. Desktop's own private shell version
  still 10.3.0; avoid claiming viewer 5.1.5 was imported.
- All work is local. No push, Actions, publication, PR or deployment.

## Integrated

- Rust layer: 380 upstream paths (Rust tree, server and Cargo metadata), retaining
  all local additions. Resolved six conflict regions in server data_model/mod.rs
  by retaining borrowed source and cooperative cancellation. Adapted EntityJob
  to borrowed type_name. Removed an unused cfg(test) hierarchy wrapper; annotated
  two native-only cross-consumer items with explicit dead-code reasons.
- TS layer: 421 upstream paths in the 15-package runtime dependency closure.
  Four renderer conflicts combined correctly: TestIFC transition + new inertia;
  frameBounds padding + damping cancellation; Vec3 + ExtraClipPlane types;
  local cooperative batch/picking imports + upstream flush helper.
- Split parser project-units contract types into project-units-types.ts to stay
  below 400 production lines; public re-exports remain compatible.
- Viewer adapter mutation-history-apply.ts imported from the pin: SESSION_EDIT
  is a retained-state history marker, and quantity replay uses canonical helper.
- Imported required worker URL build scripts and helpers, EPSG override source,
  and the full relative-import closure of the new WASM boundary harness.
- Synced tests/models/manifest.json. New AC20 source hash differs by a sanitized
  header, 33 bytes; all final A/B comparisons must use the SAME candidate fixture
  absolute path for both old and new probes. Original downloaded fixture remains.

## Passing evidence already obtained

- Native desktop tests: 33 pass, including new duplicate-record export refusal
  (upstream #7682). `native-layer-tests-after-adapter.log`.
- Native desktop clippy all targets, -D warnings: pass, `native-layer-clippy.log`.
- Root Rust clippy --workspace --all-targets -- -D warnings: pass,
  `rust-clippy-final.log` (rerun after final test-only edits if needed).
- Root exact `pnpm typecheck`: 111 tasks pass; all 3346 test files in typecheck
  programs. `typecheck-final-exact.log`. Earlier runs appended a Turbo flag to
  the audit command; these are not final root-command passes.
- Source-built WASM through canonical build script using pinned nightly and
  wasm-pack 0.15.0: pass, `wasm-build-core104.log`.
- Real WASM contracts after fetching four main fixtures: 193 pass, 0 fail,
  7 optional-fixture skips. `wasm-contract-with-fixtures.log`.
- Python Rust consumer tests: 4 pass, `python-consumer-tests.log`.
- Module size: pass, 4765 files measured and one obsolete allowlist row removed,
  `module-size-after-split.log`. Recheck after final additions.
- Rust API surface: matches 8 crates / 672 items, `rust-api-check.log`.
- Windows baseline diagnostic: standalone research crate links the ORIGINAL
  Rust 20.3 sources without editing them. Its release manifest is EXACTLY the
  new 20.4 Windows manifest and the existing wasm32 pin: 0x2eae52c333fc3244.
  `windows-baseline-manifest.json` and probe build log. Thus mesh_determinism.rs
  selects the existing strict wasm32 reference only on Windows MSVC; Linux and
  ARM pins, all strict comparisons and cross-pin guard remain unchanged.

## Test portability fixes

- Rust fixture-edit tests normalized CRLF inputs before LF-delimited injections
  (quantity/rebar/analytic profile/analytic export tests). No assertions removed.
- Export golden in-tree fixture loader canonicalizes checkout CRLF back to the
  committed LF bytes. Actual source data/fingerprint contract remains strict;
  no golden files were re-pinned. Public fixtures are hash-verified via manifest.
- Added eol=lf for vendored codegen EXPRESS inputs in .gitattributes, and
  normalized those inputs; their committed logical contents do not change.
- WASM Node tests use file URLs for dynamic imports (including mesh helper),
  invoke the actual pnpm JS entry via Node, and list tarballs relative to cwd
  to avoid GNU tar interpreting a Windows drive as a remote host.
- Server-client SSE fixture splitting accepts CRLF while the untouched first
  decoder test still exercises real raw server bytes.
- Data generator child process uses a file URL for the tsx loader.
- EPSG CLI alias test now uses an unprivileged Windows directory junction and
  Node + tsx/cli; POSIX still uses a file symlink. Removed the prior missing-bin
  skip and declared tsx in data's devDependencies. This LAST fix still needs a
  rerun of package tests.

## Running / pending

- `rust-tests-msvc-reference.log`: root cargo test --workspace currently running
  (session 4182), progressed through scan acceptance without a known failure.
- Package test attempt `packages-tests-portable-inputs.log` failed only the EPSG
  symlink permission test; last portability fix is now applied. Rerun root
  pnpm test --filter=!@ifc-lite/viewer --env-mode=loose after checking prior task
  ended. Earlier attempt logs retained.
- Viewer suite attempt was STOPPED (session 59903; its own 81 descendants only)
  after concurrent Turbo runs raced while rewriting the same dist worker URLs.
  Do NOT count those attempts as viewer test failures or passes. Its helper is
  run-viewer-suite.mjs, copied from the earlier audit. Warm a shared build with
  root pnpm build --filter=@ifc-lite/viewer^... --force --env-mode=loose AFTER
  all source edits stabilize, then run shards. Check turbo cache restores do
  not restore stale .ts worker URLs. A single forced shared build passed all
  49 tasks (`shared-build-after-race.log`), but later Rust test edits changed
  global hashes. Avoid concurrent Turbo BUILD operations sharing dist outputs.

## Remaining delivery work

1. Finish root Rust test suite; fix actual failures without skips or weakened
   assertions. Test detached csg-thread-bench consumer. Python tests passed;
   optionally build/import its native extension for ABI evidence.
2. Finish all package tests and viewer 12 shards (Edge channel, Windows helper),
   then final root typecheck and relevant script/lint/API/docs/changeset checks.
3. Rebuild/refresh API snapshot AFTER all published d.ts entries are built.
   The earlier API update attempt failed because dist was not built.
4. Prepare local layer commits, preserving snapshot baseline and excluding
   research artifacts, models, releases and generated runtime binaries.
5. Build the desktop frontend with VITE_IFCLITE_NATIVE=1 only AFTER root test
   builds finish; then embed it in a NEW Tauri release executable.
6. New release directory; SHA256 and provenance; protect prior EXE hash below.
7. Packaged quality smoke, native smoke, prior interaction/panel acceptance on
   the exact new EXE and real hangar model. Independent IFC oracle if exporting.
8. Base-vs-candidate performance: old probe already built at original
   target/profiling/examples/perf_probe.exe. Build candidate probe with SAME
   stable compiler/settings. Use exact candidate AC20 + ISSUE_129 fixture paths
   for both, interleaved --iters 5 --json --fingerprint, with agent builds/tests
   stopped. Record narrative verdict in scripts/perf/README.md without adding
   hand-written benchmark numbers to public prose.
9. Real SVD/PVF packaged load/gestures/selection/clean close if feasible;
   qualify timing/geometry evidence honestly. No claim of eliminating all jank.
10. Verify original application source fingerprints and protected releases;
    final report and concise Vietnamese answer with artifact link.

## Models / artifacts / tools

- Hangar: F:/Steel/VBA/IFC COLO/hangarvd_f10_ tan base_f01_colored.ifc (12087605 B).
- PVF: F:/Working/IFC Temp/IFC_PVF.ifc (1411171948 B).
- SVD: F:/Working/IFC Temp/SVD TRONG DONG-22.09.2026 (8H).ifc (883278635 B).
- Protected old EXE: original desktop/release/10.3.0-native-quality-audit-20261017/IFC-Lite.exe,
  SHA256 1b9a8879c4ff556324cf3aaa459b58d2fcd8f1d03fda22579bd861e98fbc1d4b.
- Fresh source WASM backup: source-built-wasm/ (research only), hashes in
  wasm-source-build-hashes.json. Runtime WASM SHA256:
  06b5b05d47c7ca8744fb04da240c7c00390b11b7187e454d1f33e0daa8b106d6.
  Check it after Turbo builds before trusting results or embedding.
- Cargo tools: C:/Users/tanng/.cargo/bin; pinned nightly installed; stable installed.
- Git Bash: C:/Users/tanng/AppData/Local/ifclite-build-tools/git/bin/bash.exe.
- wasm-pack: .../ifclite-build-tools/wasm-pack-0.15.0/wasm-pack-v0.15.0-x86_64-pc-windows-msvc/wasm-pack.exe.
- Root pnpm: node desktop/node_modules/pnpm/bin/pnpm.cjs (10.8.1).
- Legacy failed managed-worktree creation left an unmodified ownerless checkout
  at C:/Users/tanng/.codex/worktrees/core-104-upgrade/IFC-Lite. App attachment was
  rejected because creation's ignored AGENTS.override scan was interrupted.
  Do not touch unrelated worktrees or claim the manual F: worktree is attached.

Never edit the memories unless the user explicitly requests it. Relevant prior
memory was consulted in this conversation; append the required memory citation
block to the eventual final answer.

## Latest qualification update (after local layer commits)

- Layer 1 Rust source commit: 142de48a (392 paths); layer 2 TS/WASM source
  commit: 95dbbc37 (453 paths). No push/PR/Actions. Layer 3 host/tools/docs
  remains uncommitted. Viewer still 4.0.0; host version/title now 10.4.0.
- Full root cargo test --workspace PASSED: 4796 passed, 0 failed, 41 ignored,
  including doc tests (rust-tests-delivery.log). The server's two Windows
  broken-cache tests found a real cacache NotFound ambiguity: cache_entry.rs
  now checks root metadata only on negative lookups; server473 + clippy pass.
- Full viewer: 13794 pass, 0 fail, 25 existing condition skips across 12 shards,
  13819 total. All independent shards used root Turbo --only AFTER a serial
  root viewer build. No simultaneous shard builds/worker emit rewrites.
- Package tasks: 52/57 pass in packages-tests-complete.log; three remaining
  (parser, CLI, collab-server) pass in packages-qualification-rechecks.log;
  final two (create, viewer-core) pass in packages-last-two.log. No new skips.
- Create real WASM #6539 cold graph setup takes over10s on Windows. Its one
  beforeAll now has30s (six real geometry cases pass); test limits unchanged.
- Final root typecheck passed111 tasks, audited3346 test files/57 packages
  (typecheck-qualified.log). Docs437 compiled/102docs,12 existing illustrative
  skips (docs-samples-qualified.log). Updated guard tests98/98 pass.
- Native all desktop tests33 pass, native clippy -Dwarnings pass.
- New exact candidate: F:/Steel/VBA/IFC-Lite/desktop/release/
  10.4.0-native-core-20261017/IFC-Lite.exe, SHA256
  e343312c82078236a38df5dbffd6076ffc1aa1f77d40e01566f1b1e517169ba5,
  46132736bytes. Built from dirty source before layer commits (HEAD007424).
  No app runtime source changed afterward; subsequent changes are tests,
  server cache, qualification helpers/docs. Record exact build boundary.
- Packaged quality14/14 groups pass, zero page errors, real hangar:
  packaged-quality/report.json. Native totals1917264 vertices/1681800triangles.
- Independent IfcOpenShell0.8.5 of actual audit-gray.ifc:14509gray body items,
  184677non-presentation records unchanged, six world geometry samples exact.
  packaged-quality/five-selection-oracle.json. Source IFC SHA unchanged.
- Independent PNG oracle:297x178region in light/dark/colorful, zero changed
  pixels during orbit (packaged-quality/pixel-oracle.json).
- Original240application source hashes preserved, old quality EXE SHA preserved
  (preservation.json). New release added only; original source never edited.
- Native extended smoke initial failures are harness mismatches: quiet startup
  needs actual Expand ribbon click; Escape restores via animation (wait exact
  final pose before asserting); old selection test required retargeting that
  the accepted stationary-view contract explicitly removed. Current source
  mouseOrbitPivot intentionally returns null for TestIFC, preserving target.
  Updated navigation harness asserts view/target preservation and actual orbit,
  and samples visible geometry for click rather than assuming center is solid.
  Latest active native acceptance session51005, packaged-native-acceptance.log.
- Large model harness READY at research/core-upgrade-20261017/large-model.mjs;
  NOT RUN YET. Env SMOKE_EXE exactcandidate, IFC_MODEL_FILE exactSVD/PVF,
  LARGE_MODEL_LABEL=svd or pvf. It owns profile/child; checks native/source0/
  load-windowWASM0, real orbit/pan/zoom, selection, clear, window close.
- Pending: finish native extended smoke; run interaction53 and independent
  selected-colour oracle if worthwhile; run fresh SVD883MB/PVF1.41GB loads;
  A/B native probes on SAME candidate AC20/ISSUE129 files after all agent
  builds/tests/GPU sessions stop; narrative ledger only, numeric raw JSON.
  Then host upgrade doc + release provenance, final source-only layer3 commit,
  static/API/changeset/wasm-hash check and user delivery. Do not end at status.


## Final handoff

User explicitly requested completion and no further tests. The active extra smoke pipeline was interrupted and no owned test app remains. Native r3 was built from b54d6ff7; only the native title changed from r2. Final r3 quality14 passed; its first extended native attempt failed at the Box sweep. The unqualified harness experiment was removed; no runtime change was made to hide the result. R2 native29, interaction53, both independent IFC colour readbacks, panel pixels, SVD and isolated PVF native checks passed. The early r2 PVF page disconnect and r3 Box failure are explicitly retained as follow-up. Final EXE: F:\Steel\VBA\IFC-Lite\desktop\release\10.4.0-native-core-20261017-r3\IFC-Lite.exe, SHA256 b35d3d085edf89c776e3316d0e0e69b7f20915da72e264259a08a093865b789b. All three source layers committed locally; documentation handoff commit c95361aa572694ecdd6f1e75c50e38b09d4bd593. Original240 source hashes and protected old EXE matched. No push, Actions or deployment.
