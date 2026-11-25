# Nhip chinh r7 — qualified 2026-10-27

Delivered: `F:/Steel/VBA/IFC-Lite/desktop/release/10.4.0-nhip-load-20261027-r7/IFC-Lite.exe`.
EXE SHA256: `0a957e98ca82f23a56192313d9179dd6d4f9d71cd81c27fce0d87456dd76dff8`.

Source: `F:/Steel/VBA/IFC-Lite-Core104`, branch `codex/nhip-geometry-20261024`,
HEAD `13e402c42884c479fc22437c2e8f7a8c5dad53c5` plus the saved patch. Comparison
base includes the staged, uncommitted r5/r6 repairs, rather than bare HEAD.
The primary checkout's source and the original IFC were not edited.

## Outcome

Finite-source classification now builds one conservative existing BVH per
operand and retains the canonical exact predicates. Surface candidates are
restored to original triangle order; union/subtraction share coincident-face
ownership. No result cache, precision/tolerance/quality/residency change.

Two interleaved fresh-process native pairs measured 241.151
versus 171.479 median seconds, including production packet
encoding and qualification hashing. Ordered mesh, complete wire-packet and
colour-update hashes match across all four runs. Nhip has zero CSG/unsupported
counts. House/ISSUE_129 each have five interleaved pairs with unchanged payloads.
The source ledger and raw evidence are under scripts/perf/evidence/nhip-source-query-20261027/.

Exact packaged r7 reached Ready in 227.382 seconds in one observed
ordinary file-input load. GPU settlement was checked separately. All 67 meshes
captured from the actual EXE match the qualified r5 buffers; no required settled
batch is missing, no GPU error. Orbit/pan/zoom caused actual camera changes.
Owned window close was accepted and its passive child witness reported exit 0.
The screenshots were visually inspected.

## Checks and delivery

Workspace: 4,860 passed / 0 failed / 41 pre-existing ignored. Real finite-kernel
checks: 10 passed. Desktop: 36 passed. Both workspace and desktop pinned
nightly-2025-11-15 Clippy passed. Module-size, reference-walk, Rust API snapshot,
changeset and diff-whitespace checks passed. No suppressions or test weakening.
The Rust API snapshot was regenerated for three already-existing r5 exports.

Release contains README, qualification.json, full source.patch, incremental
r7-from-r6.patch and raw evidence/reproduction sources. NOT-FINAL was removed
only after all required checks. Source patch SHA256: `af628c4b58ec8ed2f54593785dd587e377bdb3ae712b2905fe82fbc7b28793a2`.
Original IFC and r5/r6 executable hashes were checked unchanged. No commit,
push, cleanup of old releases, or public website deployment.

## Boundaries

Native producer timing excludes UI/IPC waits and semantics; OS file cache is
uncontrolled. Ready is one UI observation, not an interleaved UI speedup claim.
No claim of eliminating all prior r6 navigation pauses or accelerating WASM/web.
Windows packaging reused qualified r6 WASM because wasm-pack was not on PATH;
the actual default native Rust backend was rebuilt and verified. Latest stable
Clippy flags pre-existing style findings in untouched crates; the repository's
canonical pinned Clippy passes. Holter/ISSUE_053 are absent locally.

No required r7 qualification work remains.
