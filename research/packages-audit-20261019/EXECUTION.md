# Package and custom-behavior audit, 2026-10-19

User charter: audit all62 integrated workspace packages and their dependency
closure, verify retained custom behavior on exact packaged EXEs, and resolve the
previous unqualified Box sweep and root Windows lint launch failure.

Base:17bf338d37325141c771da222a80b18a8652b4fc, isolated checkout Core104,
branch codex/packages-audit-10.4.0, origin LTplus-AG/ifc-lite.
Protected current release:10.4.0-full-packages-20261019-r1, EXE SHA256
9e4bfb5d6d3594172735d5b453a6f93fb56bf678e0dccd660a9734a30f3380a1.
Original dirty checkout, prior releases/models/user-run processes remain protected.

Finite completion criteria:
1. Inventory62 manifests, versions/source pin, workspace edges and dependency
   advisories; review upgrade adapters and custom seams. Triage real findings.
2. Reproduce root lint and exact r1 Box gesture failure before fixes; retain logs.
3. Fix demonstrated defects with behavior tests; do not weaken assertions,
   production bounds, lint baselines or module-size budgets.
4. Run root lint end-to-end, root typecheck/tests appropriate to changed logic,
   a fresh complete package suite if dependency changes warrant it, custom UI
   acceptance, native Box/navigation and persistent-export readback.
5. Build a new release directory if runtime/dependency inputs change, audit its
   exact EXE, keep hashes/provenance and a final findings/resolution report.
6. State any real external-account, fixture or performance limits honestly.
No push, remote issue/PR, Actions, deployment or user-process shutdown.

Measured findings and changes:
- Full inventory:62 workspace packages,57 published,210 workspace edges, no
  missing dependency; exact versions still match source61d209288c1b117d405628ead302d0ee700bd2a0.
- Windows root lint ENOENT reproduced. Launch installed pnpm via its Node entry,
  no cmd/shell interpolation. Four launcher behavior tests and12 existing lint
  regressions passed. Canonicalize Windows baseline keys to POSIX; only tighten
  measured unused-local counts and add missing zero guards (including load-trace).
- Dependency audit:8 advisories before,0 after. Patch dompurify,
  brace-expansion,source-map-js,shell-quote; remove unused static-copy plugin
  (its braces dependency has no patch; Cesium already uses the local copier).
- Real a11y gate found3 custom ViewCube group warnings. Use native fieldsets
  with scoped box reset, retaining direct cube-body/stage perspective structure.
- Old r3 and current r1 EXEs both passed28 real Box/navigation groups before
  runtime changes. Historical first-sweep failure not reproduced: no historical
  event trace means no proven retrospective product root cause.
- Fix a concrete harness gap: native final two-model scenario previously could
  accept an uncommitted Box draft. Require real pointer sweep and enabled cut.
  Add bounded pointer/focus evidence and explicit DOM blur cancellation check.
  Strengthened r1 run passed29 groups. Final r2 adds fixed ViewCube dimensions.
- Root package builds62/62 passed after dependency install. Fresh full62 suite,
  final root lint and custom viewer suite are running; retain all outcomes.
- Module-size audit against17bf passed with no added/raised budgets; API surface
  remains57 packages/104 surfaces/10198 exports; test wiring and generated docs
  passed. No Rust or package production source changes, no geometry/perf claim.

Outstanding qualification: complete running suites, root typecheck, new native
build; exact r2 quality/Box/navigation/persistent export oracle; fresh SVD/PVF
loads. Verify Cesium copied assets, original source/input/release preservation.
Investigate sample federation warning using actual spatial-reference metadata:
the canonical resolver refuses unknown vertical datum even for equal horizontal
EPSG codes; never bypass this fidelity guard to suppress a warning.

16:02 root aggregate lint completed successfully:9,073 files,4 targets,
136 rules,0 errors. Existing nonblocking warnings remain visible; no baseline
raised. The portable invocation was also exercised directly: Corepack's pnpm
bootstrap is deliberately excluded from installed-CLI discovery (it can fetch
a different tool). One initial direct regression run using the system bootstrap
was interrupted at its verified owned runner; the configured local tool run
passed17/17 including the actual viewer-embed compiler baseline test.

Separate desktop npm audit found the pinned build tool pnpm10.8.1 carries known
advisories (not an EXE runtime dependency). Follow up to10.34.7 in both declared
tool pins after active suites finish; then rerun frozen install/audits/lint.

16:04 expanded viewer suite finished750 pass/2 fail/0 skip (752 tests).
Both failures are real create5.1 adapter compatibility: wall reader forwards its
documented missing-depth NaN sentinel to the now-strict fromNativeLength.
Guard conversion at the reader; retain old mesh and unknown measurement.
Adjacent fromNativeLength consumer audit found material layers doing the same.
A real parsed-IFC missing/dangling-layer regression failed before its fix;
guard only finite conversions, retaining type/material data and NaN unknown.
Targeted wall/navigation/federation retake passed; final broader retake pending.

16:15 final expanded viewer retake passed829/829,0 skips,0 failures.
The original752-case attempt remains with its two diagnosed failures;
length-reader targeted green is85/85. Complete CLI suite now passes1471
with16 existing conditional skips in the still-running full package sweep.
Independent IfcOpenShell read confirms both bundled samples have null
IfcProjectedCRS.VerticalDatum; source evidence is sample-georeference.json.
Oracle interpreter: F:/Steel/VBA/IFC COLO/recovered_source/.venv/Scripts/python.exe
(the default Python3.14 has no IfcOpenShell).

16:33 all-package run ended61/62 suites, with one mutations scheduling-order
test timing out5s. Isolated retake reproduced. Three diagnostic runs preserved
3000 inputs and329 real default timer yields, each4.91-5.03s with about15ms timer
delay on this Windows Node host. Test-only Windows deadline15s (Linux5s unchanged),
no changed data/assertions or production work/byte/scheduler limits. Complete
mutations retake370/370 passes. Composite full suite coverage62 packages:
22,408 passed,164 existing conditional skips. No claim of one all-green62-task run.
The new empty changeset records test-only portability, no package version bump.
pnpm10.34.7 installed in desktop and pinned at root; frozen lockfile install
passes without re-resolution. Fresh root1092-dependency and desktop53-dependency
registry audits both0 known advisories. Final root lint/typecheck underway.

USER REQUESTED PAUSE 2026-10-19T10:03:59.924669+00:00. Stop work; no final delivery claim.
Checkpoint: r2 EXE21af960205c35f931a6ed7af7227875ec238ab0ca698043920e070acf215ec2a exists and passed quality15/native30 twice/interactions53/oracle. It is an internal candidate; later native wall-axis unit fix is NOT embedded.
Runtime warning traced by unit-interactions-probe/report.json to create extractWallSegmentsForStorey; probe later failed a palette hover, so not a passed interaction run. Real native-overlay regression proved mm1000x error. Fix in packages/create/src/in-store/extract-walls.ts, tests/README/curvy-lines-add changeset pending.
First corrected create full suite1599 passed, but root typecheck found test assigned Uint8Array instead of IfcSourceBytes. Fixture now uses EMPTY_SOURCE_BYTES. Canonical full-suite retake log create-canonical-final.log; inspect completion before reuse. Root lint-r3.log measured the earlier fixture type failure and must be rerun. No type suppression added.
Resume ONLY on user request: finish typecheck/lint and corrected create/UI validation; commit pending unit fix and smoke metadata diagnostic change; build NEW r3 directory (preserve r2), then exact r3 quality/native/interactions+oracle and SVD/PVF loads. Large-model runs NOT yet performed this audit. Do not present r2 as containing pending fix.

RESUMED 2026-10-20 at user request. Same checkout/branch88c56 plus saved changes, no other source drift. Canonical create retake1599/14skip confirmed. Root typecheck120/120;3597test files passed. Fresh npm/pnpm registry audits both0known advisories. API/module/test-wiring/source-text gates pass; source-text gate warns shallow clone cannot compare origin/main allowlist identity, so compare audit base separately. Final viewer/rootlint running. Final interactions driver uses a real submenu click and explicitly rejects false UnitExtractor warnings. Large-model driver now checks page errors after clear/close, closing an old evidence gap.

2026-10-20 final native qualification: exact r3 EXE ede20104a6152a308bdb50fed44f870d1ac5d0539e623e150abb311325b89545 from f1551785 passed quality15 (instrumented fresh retake), Box/navigation30, interactions54 and independent export oracle5red/14504gray/11geometrysamples. First quality run's11px canvas change coincides with viewport screenshot height960->949; diagnostic retake kept960 and passed unchanged assertions. SVD143s/PVF202s native loads, counts equal prior runs, actual orbit/pan/wheel/pick, clear and ordinary host close0;0pageerrors including cleanup. Timings are completion observations under concurrent Rust validation, not a benchmark comparison.
Extended RustSec audit: root4vulnerabilities +2unsound notices; fix crossbeam0.9.20/zip9.0.5/event-listener5.4.2 and disable optional cacache mmap. Remaining root notice async-std maintenance only. Desktop standalone467-dependency lock0vulnerabilities; glib/proc-macro-error notices are outside Windows actual tree. Git d636a260 records source remedies. ZIP9 adapter name Result handled; first new UTF8-negative fixture expectation was wrong: source decoder intentionally supports CP437, so real legacy-name roundtrip test now preserves that contract (474servertests pass). Feature BOS golden failed five Windows system-byte pins; explicit canonical Unix header makes all five byte hashes match without re-pinning. Full BOS feature suite passes. Wrong feature name parquet attempt retained; correct is parquet-bos. Repo-pinned nightly1.93 Clippy all-targets -Dwarnings passed40s; extra stable1.99 Clippy flags five style lints in unchanged core/clash sources, retained with no core edits/suppression.
A separate standalone Cargo desktop relink differed from Tauri EXE (3a56dbb8...); it is only internal target output, never substituted for the exact tested delivery. Source manifests record headless-only later changes and disabled optional BOS path; desktop-active sources/standalone lock/embedded assets remain unchanged. Final all-workspace Rust run underway after corrected CP437 fixture; do not claim green until it finishes.

COMPLETE 2026-10-20. Final full Rust workspace run exits0:4797passed/41existingignored/303resultprograms. Full optional BOS766passed and server474passed/1existingignored; pinned-nightly Clippy exits0, no suppression. Final source13e402c42884c479fc22437c2e8f7a8c5dad53c5; tracked source clean, research remains untracked. Original checkout still codex/desktop-v10.3.0 at471284f476d64a659ae607eeec2115ca3afcb9fe. Final preservation verifies240protected source files,3oldEXEs and3input models unchanged. New release folder10.4.0-packages-audit-20261020-r3 contains qualified EXE ede20104a6152a308bdb50fed44f870d1ac5d0539e623e150abb311325b89545 plus native/final source manifests, qualification/provenance,154evidence files and hash manifest. Audit branch absent from remote; no push, Actions or deployment. Both large-model recorded orbits also independently verify fixed targets and~17degree actual direction changes. Required task work complete; remaining boundaries are recorded in the report.
