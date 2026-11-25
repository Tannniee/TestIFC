# Full package integration — 2026-10-19

User authorized upgrading all packages after the Info audit identified 56 local
packages versus 62 on the deployed web: 25 equal versions, 31 older, six absent.

## Contract

- Checkout: F:/Steel/VBA/IFC-Lite-Core104; branch codex/packages-full-10.4.0.
- Starting source: c95361aa572694ecdd6f1e75c50e38b09d4bd593.
- Package source: production 61d209288c1b117d405628ead302d0ee700bd2a0.
  Every one of its 62 package versions matches the observed Oct-18 deployed Info.
  Its matching Rust 20.4/WASM source is already integrated. The later Rust 21.4
  change on current production is a separate engine migration.
- Upgrade source and consumer contracts; never change versions only to make Info
  look synchronized. Preserve custom viewer UI 4.0, native host and transport,
  Colorizer, stationary canvas/panels, TestIFC navigation and bounded picking.
- Preserve the original dirty checkout F:/Steel/VBA/IFC-Lite, user processes,
  source models and all releases. New artifact directory only. No push/Actions.
- Six additional library packages must have source, exports, dependencies and
  their existing upstream behavior tests, not just rows in Info. This does not
  silently replace the custom UI with the entire upstream viewer UI.

## Ordered slices

1. Preflight all package source changes against the original upstream base;
   retain the already integrated fifteen-package core closure and local fixes.
2. Integrate missing infrastructure/cloud/semantic/AI/IDS dependencies and the
   remaining data, scripting, creation and automation libraries as coherent
   dependency groups. Adapt existing viewer consumers at real API boundaries.
3. Update dependency lock, generated API/ambient surfaces and matching guides;
   keep the module-size and type/test checks intact.
4. Root Turbo build/typecheck and tests for changed package groups, selected
   viewer integration tests, and exact packaged quality/Info verification.
   Avoid repeating the previous exhaustive unchanged Rust and large-model audits.
5. Source commits per verified group, separately packaged EXE, hashes/provenance,
   complete 62-package comparison and bounded handoff report.

## Progress and exact qualification state

- Applied 1,138 package file changes via BASE=e79f273 -> TARGET=61d2092 over
  starting custom source c95361aa. Fifteen previously upgraded core packages
  were preserved. All 62 target package versions match the observed web table.
- Only package merge conflict was collab-server's test access-control fixture:
  production now uses the same obstructed temp destination on all OSes, which
  supersedes the previous Windows-only local port without losing assertions.
- Root package build PASSED 62/62 tasks (packages-build.log). Actual source-built
  WASM hash remains 06b5b05d47c7ca8744fb04da240c7c00390b11b7187e454d1f33e0daa8b106d6.
- Vitest overrides aligned to the matching upstream 5.x rather than forcing
  new packages through the old 4.x override; packageExtensions restored.
  Root paths restored from the pin; install uses pnpm10.8.1 --ignore-scripts.
- Module ratchet PASSED after deleting six obsolete/shrunken rows: zero added
  or raised budgets. Source-assertion gate PASSED29 allowlisted/191 marked/0new.
  Test wiring PASSED64 packages. Re-run size after final source settles.
- Root package tests run2 completed 59/62 package tasks successfully. Run JSON:
  .turbo/runs/3KtZ1xuVx51ljpbllAysWbDSH79.json. Failures are cli, flow-nodes, mcp.
  Do not repeat the 59 unchanged successful tasks; recheck the corrected three.
- Native BCF store failures are Windows directory-fsync EPERM. Actual probe
  establishes Node O_RDONLY directory handles cannot flush on Windows while
  O_WRONLY/O_RDWR handles can. Microsoft FlushFileBuffers requires GENERIC_WRITE.
  Production store now chooses O_WRONLY only on win32 and retains all actual
  fsync, hardlink, identity and fail-closed checks. No sync error is ignored.
- IMPORTANT Windows storage prerequisite: every ancestor being synced needs
  a writable handle. C:/Users and C:/ are not writable to this process, while
  all F:/Steel/VBA/IFC-Lite-Core104 ancestors including F:/ are verified capable.
  Recheck native BCF tests with an OWNED F: temp root (TMP/TEMP scoped to the test
  child only), document this requirement and add a real default-path refusal
  invariant if appropriate. Do not bypass fsync or weaken duplicate-write guards.
  directory-sync-probe.log retains actual results.
- CLI fixes made after run2: dense staircase fixture normalizes CRLF before
  inserting4,096 real points; golden output normalizes only fixture-path spelling;
  new URL.pathname test uses replaced with fileURLToPath; file aliases in two
  new flow-review tests use directory junctions on Windows while retaining the
  actual canonical-path/once-only assertions. Obsolete diagnostic-header local
  hack removed from mutate-step-record.ts because new upstream now diagnoses
  all unreadable IDs itself (old hack changed its new expected error format).

## Viewer scope decision and active operation

Initial root typecheck after full library migration had only EIGHT viewer
contract errors: Flow NodeStatus gained restored/review/paused; RunResult.review
became required in three fixture factories; IDS SupportedLocale expanded.

An attempted wholesale upstream Flow UI import pulled the new content/review
workbench through dependencies (567 more files, 678 cascading errors). That is
a separate product/UI migration and not needed to upgrade all library packages.
It must NOT replace the custom UI. The experiment is being removed using exact
owned-file plans/hash checks in keep-custom-viewer.py, restoring only recorded
viewer paths from c95361aa and deleting only our new files. Preserve the imported
hooks/ids and idsValidation.worker locale adapters, bcf-http-server.ts test peer,
generated bim-globals.d.ts, all full package source, and matching docs.

Current rollback exec session35122. First attempt stopped at a transient EINVAL
write of properties.en.ts; script now supports partial restore and writes via
a sibling temporary file then replace. Poll it. All paths are verified inside
Core104/apps/viewer; original checkout remains untouched. Viewer manifest returns
to its custom deps (six libraries still exist/build in workspace and are consumed
through SDK/CLI); do not keep unused direct dependencies solely for Info.

After rollback, adapt the eight actual contracts minimally: add three localized
Flow status labels, include three statuses in FlowPanel.statusCounts, add
review:[] to RunResult fixtures (FlowPanel.player-publish, publish-provenance,
flowSlice tests). IDS locale adapters are retained from the source pin.
Then root exact pnpm typecheck; package tests only corrected three; relevant
viewer integration/Colorizer/navigation tests and exact final packaged quality
plus Info62 check. A focused TEST_PATTERN filter can be added to the existing
root viewer test command while keeping its default all-tests behavior; do not
invoke package-local test/typecheck scripts.

No source commits yet for this new task. Branch codex/packages-full-10.4.0
starts at c95361aa. Research is untracked. Existing EXE r3 is protected and user
had it open (PID35440 when inspected); never terminate a user-run app. New
delivery directory should be distinct, e.g.10.4.0-full-packages-20261019-r1.

## Final narrow viewer adaptation and portability diagnosis

- Owned UI experiment rollback completed; effective viewer diff is narrow locale,
  Flow status/review eligibility, required RunResult fixtures, generated ambient
  declarations and the controlled BCF HTTP test peer. Original custom UI remains.
- Root exact pnpm typecheck passed all120tasks and all3597 test files; final rerun
  follows the additional review-publish guard and Windows path normalization.
- Root docs:check-samples passed474 snippets/115docs (12 marked illustrative skips).
  Generated API snapshot57publishedpackages/104surfaces/10198exports and14namespace
  bim globals refreshed. README gate passed57. Module ratchet vs c95361aa passed
  with zero additions/raises and six obsolete rows removed.
- Windows direct runtime probe showed mkdir(recursive) returns an extended
  \\?\ path even when its input is an ordinary absolute path. BcfPublicationStore
  now resolves its configured directory and compares mkdir/ancestor paths in
  their canonical Windows namespace spelling using node:path.toNamespacedPath.
  Actual sync and fail-closed identity/receipt guards remain intact.
- CLI child preloads use file URLs (ordinary absolute F: paths are not ESM URLs).
  Attempts3/4 retained as diagnostic evidence; their failures predate the complete
  mkdir namespace fix. Do not claim those as final results.
- New regression invariant: successful partial writes with pending RunResult.review
  cannot be published as a completed layer. Existing Flow UI shows amber review.

- Qualified native EXE SHA256:9e4bfb5d6d3594172735d5b453a6f93fb56bf678e0dccd660a9734a30f3380a1. Actual packaged quality PASSED15/15, including UI Info62 exact versions, real hangar load1681800triangles, fixed panels/gestures and Colorizer Save as11873913bytes. Runtime errors0. Protected240source hashes and priorr3SHA matched. Root qualified typecheck PASSED120/120. MCP run6 PASSED83files/735tests (5existingconditional skips).
- Windows heavy journal test deadlines now preserve all16/256/130 real operations rather than timing out mid-correctness-run; original production work/byte bounds and assertions unchanged. One genuine symlinked-entry refusal uses a Windows junction. Default-path CLI test isolates both HOME and USERPROFILE in child-only owned temp homes.
- Empty stale Core104 index.lock from10:18:32 (no open handle; every active Git process newer) was archived reversibly under this research directory before staging. Primary original checkout source/index was not edited. Staging2827source/docs/test files excludes research, binaries, caches and dist.

## Completed handoff

- Source commit17bf338d37325141c771da222a80b18a8652b4fc on
  codex/packages-full-10.4.0. Tracked checkout clean. No push/Actions/deployment.
- All62 package suites/cases covered by the documented composite evidence:
  original59 full successes; MCP735passed/5conditional skips; complete Flow
  248passed/16conditional skips; full CLI1465passed+six repaired cases=1471
  unique passes/16conditional skips. The three-file CLI retake passed13/14;
  the remaining exact retained-process case passed the final strict behavioral
  retake19.79s. Its seven filtered cases had already passed. No new source skip.
- Final root typecheck120/120 and all3597test files passed after the test ports.
  Selected viewer294/294; exact native EXE quality15/15 with0page errors.
- Final release F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-full-packages-20261019-r1,
  EXE45016064bytes, SHA2569e4bfb5d6d3594172735d5b453a6f93fb56bf678e0dccd660a9734a30f3380a1.
  Contains provenance,2150488-byte source-input hash manifest (15557tracked
  files/733embedded frontend files), qualification, all62version comparison,
  source handoff guide, README, SHA256SUMS and actual Info screenshot/report.
- Actual artifact was built from the upgraded dirty c95361aa-based tree before
  final source commit; later changes were test portability/deadlines/docs. Verified
  no production source file modified after EXE build; metadata records this rather
  than claiming a clean-at-build checkout. Embedded local buildSHA remains dev.
- Final checksum verified. Protected240original source hashes, priorr3EXE and
  real input model hash verified unchanged. No owned BCF probe processes remain.
- No additional tests needed after the passing scope; limitations and historical
  deferred Box sweep remain explicit in the source/release handoff.
