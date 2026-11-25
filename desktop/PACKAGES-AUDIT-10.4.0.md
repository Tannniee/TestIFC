# Package and custom-desktop audit, 2026-10-19–20

Follow-up charter: qualify the62-package integration, investigate the previously
deferred Box failure and Windows lint launcher, and verify retained custom
behavior on a newly built executable. Work starts at
`17bf338d37325141c771da222a80b18a8652b4fc` in the isolated Core104 checkout,
branch `codex/packages-audit-10.4.0`. The original checkout and old releases are
protected. This is a local delivery; no push, Actions or deployment.

## Findings and remedies

| Finding | Evidence and remedy |
| --- | --- |
| Windows root lint could not launch pnpm | Reproduced `ENOENT`. All four lint entry points now execute the installed Node CLI directly. Arguments with spaces, quotes and shell metacharacters remain literal; child failures remain failures. Direct invocation refuses a missing tool and never invokes the Corepack download bootstrap. |
| Windows unused-local counts used different keys | Normalize relative paths to forward slashes. Actual measurements now use the committed per-package baseline. Five rows only decrease; seven missing packages receive zero guards. No raised baseline, suppression or reduced test assertion. |
| Vulnerable dependency closure | Patch DOMPurify, brace-expansion, source-map-js and shell-quote. Remove the unused static-copy dev plugin, which pulled unpatched braces. The actual Cesium asset copier remains. Pre/post machine-readable audits are retained. |
| Old Box sweep was unqualified | Both exact old r3 and package r1 EXEs passed the initial28-group real-input retake. The historical first-sweep failure did not reproduce; its original cause remains unproven. |
| Native two-model Box test accepted a draft | The harness previously swept only in browser-URL mode. It now always drags through real pointer input and requires active clipping with two models. It also records bounded pointer/focus events and explicitly tests cancellation via a dispatched blur event. The latter is a DOM-listener invariant, not physical OS focus automation. |
| Custom ViewCube had three accessibility warnings | Replace generic group divs with named native fieldsets and reset their default boxes locally. Keep the stage/body perspective relation and all controls. Native dimensions, pointer and keyboard behavior must be requalified. |
| create5.1 rejects missing dimensions used as reader sentinels | Expanded viewer tests reproduced two wall-resize failures. A further real parsed-IFC regression reproduced the same class for missing material-layer thickness and dangling layer references. Convert only finite measurements; retain the readers' unknown-value sentinel, existing mesh and units. Do not relax the package converter or invent dimensions. |
| Mutations scheduler test exceeded the default deadline on Windows | The full sweep and an isolated retake reproduced a5s timeout. Three measured probes completed correctly in4.91–5.03s, with329 actual timer yields for all3000 rows; median timer delay was about15ms. Allow15s only for this Windows test; keep every input row, the default scheduler and ordering assertion. Production scheduling and work/byte limits are unchanged. |
| Desktop's pnpm10.8.1 build tool had26 advisory entries | Pin root and desktop tooling to10.34.7, retain the lockfile, verify a frozen install. Separate root and desktop registry audits now both report0 known advisories. This tool is not embedded in the EXE. |
| Native wall-axis snapping re-read released STEP bytes | The real EXE warning was traced to `extractWallSegmentsForStorey`. A real IFC/overlay regression proved the millimetre branch returned1000× coordinates; metre files produced a false warning. Prefer a valid cached scale only with declared unit metadata for source-empty stores. Preserve raw-source resolution and warnings for unconfirmed units. The full corrected package and a new EXE are requalified below. |
| Headless Rust workspace lockfile had four vulnerabilities and two unsoundness notices | RustSec found crossbeam-epoch0.9.18, zip8.6.0, event-listener5.4.1 and optional memmap2 0.5.10. Update the first three to0.9.20/9.0.5/5.4.2 and disable only cacache's optional mmap backend. Keep the existing async cache API and on-disk format. Handle ZIP9's fallible name decoder as a client error while retaining valid legacy CP437 names, exercised through real archive bytes. The newer compiler's deprecated atomic update is expressed through portable compare-exchange, retaining monotonic cache stamps. |
| Optional BOS golden output inherited the host ZIP system byte | The Windows feature run moved five available BOS pins. Explicitly use the committed Unix archive-header convention on every host. All five whole-archive byte hashes match again without editing any golden file. This optional `parquet-bos` feature is disabled in the delivered desktop build. |
| First r3 quality attempt observed an11px canvas-height change | Retain the failed attempt. Its screenshots are1440×960 initially and1440×949 at failure, so the viewport itself changed height. A fresh instrumented run recorded the window, status bar and canvas dimensions for every panel; all15 groups passed with the window fixed at1440×960 and canvas1376×891 throughout the panel sweep. No assertion was relaxed and no layout code was changed to hide it. |

## Package boundary

All62 package versions still match the chosen upstream package source
`61d209288c1b117d405628ead302d0ee700bd2a0`:57 published packages,210 workspace
dependency edges, no missing target. The API snapshot matches104 surfaces and
10,198 exports. Info remains a complete workspace catalogue, not a runtime SBOM.
The custom viewer stays4.0.0, host/WASM10.4.0 and Rust20.4.0. The only package
runtime patch is the native wall-axis unit adapter above, with a pending patch
changeset; package versions are not relabelled. Rust core, geometry, processing
and WASM runtime sources stay unchanged. Additional Rust adapters are in the
separate headless server and optional BOS archive writer; the root lockfile is
not the standalone desktop lockfile. This audit makes no new geometry/performance
claim.

## Qualification evidence

The execution record and raw logs live at
`research/packages-audit-20261019/`. The handoff `qualification.json` and
`provenance.json` bind final results to the delivered EXE and input hashes.
Only completed runs belong in that handoff; failed and interrupted attempts
remain in the research record with their disposition.

The fresh all-package sweep completed61 successful suites out of62; mutations
had the diagnosed timer deadline failure above. Its complete370-case retake
passed after the test-only portability correction. This is composite coverage,
not a claim that the original62-task run was all green. The expanded custom
viewer suite first passed829/829 with0 skips after the dimension-reader
corrections. The final expanded retake passed855 cases with1 existing external
fixture skip. Complete create retake:1599 passed,14 existing conditional skips.
Composite package coverage is22,410 passed and164 existing conditional skips
across all62 complete suites. Root typecheck passed120/120 tasks and covers all
3597 test files; root lint passed9073 files/136 rules with0 errors, and all18
Windows-launch/baseline regression cases pass.

The r3 Tauri executable has SHA-256
`ede20104a6152a308bdb50fed44f870d1ac5d0539e623e150abb311325b89545`,
built from `f15517854cc92a7ab31746fcd1a2772c7cdf13fd` with733 embedded
frontend files. Exact-EXE evidence:15 quality groups in
`quality-r3-diagnostic/`,30 Box/navigation groups in `native-r3/`, and54 real
interaction groups in `interactions-r3/`, with0 uncaught page errors. The quick
colour submenu is opened by a real click in the final driver; the earlier
instrumentation-only hover probe failed and is not counted as a passed run.

Independent IfcOpenShell0.8.5 reopened the UI-exported IFC:5 red/14504 gray,
14509 body items;184677 non-presentation records unchanged;11 geometry samples
retain identical vertices/faces and correct material colours. Native reopening
retains1917264 vertices/1681800 triangles. The final editing run emits no false
UnitExtractor warning after source release.

Fresh npm audits report0 known advisories for1092 root dependencies and53
desktop-tool dependencies. RustSec0.22.2 reports0 vulnerabilities after the root
dependency remedies and0 vulnerabilities in the separate467-dependency desktop
lockfile. The root's remaining informational notice is async-std being
unmaintained. The desktop lockfile also lists proc-macro-error maintenance and
glib unsoundness notices for other platform closure; neither appears in the
actual Windows normal/build dependency tree. No advisory is ignored. These are
dated advisory lookups, not a proof against undisclosed vulnerabilities.

The final `cargo test --workspace --locked` completed303 test programs:
4797 passed,0 failed,41 existing ignored cases. The separate full `parquet-bos`
feature run passed766 cases; these overlap the workspace tests and are not
added to a unique-test total. The server retake passed474/474, with1 existing
ignored case. External fixtures still follow the repository's conditional
fixture rules. Clippy's exact all-targets `-D warnings` gate passed on the
repo-pinned nightly-2025-11-15. An additional stable1.99 attempt flags five style
lints in unchanged core/clash files; it remains in the evidence, with no core
edits or warning suppression.

Both exact large inputs completed a fresh native load, real orbit/pan/wheel,
viewport selection, clear and ordinary window close (host exit0). No uncaught
page error occurred, including after cleanup. Source bytes and WASM instance
counts remain0. The measured orbit keeps its target fixed and changes the view
direction by about17 degrees in each run.

| Input | Meshes | Vertices | Triangles |
| --- | ---: | ---: | ---: |
| SVD,883278635 bytes | 163867 | 304642800 | 183466717 |
| PVF,1411171948 bytes | 160673 | 245093805 | 148025417 |

All three counts match the historical same-input native runs. Observed load
completion was143s/202s under concurrent Rust validation; this is not an idle
benchmark, a speedup claim or universal world-space geometry parity evidence.

Delivery: `10.4.0-packages-audit-20261020-r3`. Its independent handoff manifest
records the native build source and later headless source qualification below.

The native source snapshot precedes the root/server dependency remedies.
Desktop-active runtime sources, standalone lockfile and embedded frontend are
unchanged; the actual Windows tree excludes server/cacache/ZIP/memmap2, and BOS
is behind a disabled optional feature. A later
standalone Cargo relink produced a different internal EXE and was not substituted
for this exact tested Tauri artifact. Source-input and handoff manifests record
the build commit, subsequent source-only changes and artifact separately.

## Remaining boundaries

The bundled EPSG:32760 revision model emits an alignment warning. The canonical
spatial resolver deliberately refuses an unknown vertical datum, even when the
horizontal EPSG code matches. Never treat this as permission to assume equal
height systems or silently move the model. The final native report records
actual spatial metadata; the viewer's federation tests exercise refusal without
moving geometry. A real survey alignment still needs authoritative input data.

Existing nonblocking lint debt is retained under its ratchets (580 unused-local
diagnostics across source and tests). A green root lint means the configured
error and regression gates pass, not that every historical warning disappeared.
Native BCF durable storage still requires a write/flush-capable directory ancestry;
configure `IFCLITE_BCF_OUTBOX_DIR` on a supported volume. Tests use an owned F:
directory and retain real durability checks and all server-effect assertions.
The optional Rust BOS writer retains its documented narrower table set than the
TypeScript writer (no Relationships/Strings/SpatialHierarchy tables). Its current
format is preserved and tested here; cross-writer table parity is not introduced.
Live cloud-account authorization, the complete external fixture corpus and
universal world-space geometry parity are outside this qualification.

## Security sources

The retained registry audit reports identify the exact advisory ranges.
Primary disclosures:
[shell-quote](https://github.com/advisories/GHSA-pqg4-j6r4-53mv),
[braces, no patched release](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
[DOMPurify](https://github.com/advisories/GHSA-6688-9rhm-gjv2),
[brace-expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
and [pnpm build-tool advisories](https://github.com/pnpm/pnpm/security/advisories).
Rust findings use [RustSec](https://rustsec.org/), including
[crossbeam-epoch](https://rustsec.org/advisories/RUSTSEC-2026-0204.html) and
[ZIP extraction](https://rustsec.org/advisories/RUSTSEC-2026-0369.html);
the retained JSON reports contain every advisory and the exact resolved ranges.
A clean advisory lookup is a point-in-time dependency check, not a proof that
all application code or future disclosures are vulnerability-free.
