# Source-frame reuse investigation (2026-10-26)

Scope: source inspection only, on `F:\Steel\VBA\IFC-Lite-Core104`, branch
`codex/nhip-geometry-20261024`. No production change, model run, build, or app
operation accompanies this note. The FPS r6 changes remain untouched. This is a
diagnostic and regression proposal, not a measured speedup or measured hit rate.

## Feasible candidates, in order of the evidence needed

1. **Precision-namespaced operand/item meshing reuse.**
   `router/voids/source_frame.rs:93` creates a fresh router for each exact or
   fallback attempt. Exact mode replaces the extrusion processor with profile
   chord tolerance `P/4/unit_scale`; it deliberately does not inherit the normal
   mapped-source, item-dedup, or BREP signature caches. Import mode inherits them.
   The constructor `with_scale_and_quality` does not arm `item_dedup_cache`, so
   exact mode currently has no structural item-dedup lookup at all. Repeated
   profiles or cutter solids may therefore be refined repeatedly across hosts.
   A shared cache in a distinct precision namespace could avoid that work without
   reusing the coarser ordinary-import mesh. Repetition and its cost are unknown.

2. **Accepted local-frame Boolean-result reuse.**
   A cache can sit around the pure result of `try_authored_group` or
   `cut_authored_one`, below `record_authored_result`, before world restoration.
   It must retain exact operand identity and reproduce only successful results.
   Different hosts, cutter placements, or progressive stock results may make
   every key unique; geometry that looks similar is insufficient. Measure first.

3. **Repeated validation/consolidation work.**
   `finish_authored_mesh` cleans/closes raw output and independently consolidates,
   cleans, and closes another candidate, then checks volume and stock bounds.
   `source_frame` subsequently closes in the authored frame and again after
   f64-to-f32 world restoration. These are different inputs/proof obligations.
   Do not remove the later gates or reuse a local closure verdict after a
   transform. Measure their individual costs; reuse is permissible only for the
   same exact input and same validation policy.

These are cold-open candidates within one immutable model job. A disk cache for
repeat-open is a separate product feature with source/engine invalidation and
transport/schema obligations. Native semantics overlap is not proposed: the
parent's standalone semantic measurement has already made its limited scale clear.

## A cheap, non-retaining census

Add a research-only, opt-in instrumentation pass before implementing a cache.
Use the existing filtered native/processing probe to select hosts; do not start
another full-model run while a load benchmark or user session is being measured.

The first pass needs counters and timings only, with no payload dumps:

| Site | Counters and timing | Question answered |
| --- | --- | --- |
| `try_source_frame`, per `exact=true/false` attempt | host, P bits, eligible/accepted/rejected, wall duration, retry ordinal | Which accepted routes and abandoned attempts cost time? |
| exact `process_representation_item_body` | item type, source item ID, meshing duration, cache-enabled flag, prospective namespace/signature | Is refinement work repeated even before cuts? |
| `try_authored_group`, at entry and every return | exact key, host, ordered cutter count, triangles, input bytes, hash duration, work duration, accepted flag, accepted output digest | Can accepted multi-cutter work be reused? |
| `cut_authored_one`, at entry and return | same fields, single-cutter key, path chosen (analytic, 256, 16, unscaled, shifted) | Is sequential work repeated? |
| `finish_authored_mesh` | clean/raw-close/consolidate/consolidated-close durations; outcome | Does sanitation dominate rather than the Boolean? |
| `source_validation::excludes_cutters` | operand re-mesh time, ray/sample time, work-cap exit | Is fallback spending time reconstructing identical operands? |
| `collate_refs_in_basis` | group candidates, index checks, vertices verified, verification duration, rejects | How much already-materialized geometry is checked again? |

Do not simultaneously time a parent operation and sum its nested operations as
independent work. Report nested times explicitly as inclusive/exclusive. Keep
thread-local maps/counters and merge once at the end; never hold a global lock
while hashing large arrays, meshing, cloning outputs, or invoking the kernel.
Use a hard bound on retained key records and report overflow. Sampling a bounded
set of hosts is valid for diagnosis but cannot establish the full-model hit rate.

For an initial low-overhead census, item-ID+namespace counters can reveal repeated
references with no mesh hashing. This is only a candidate filter: different stock
frames/placements may make the actual meshed inputs distinct. On a second pass,
compute full content hashes only at the proposed cache boundary for those hosts.
Record hash cost separately so low-reuse inputs do not appear to be a free win.

Aggregate each key to:

```
operation + sourceNamespace + policyDigest + exactInputDigest
calls, accepted, rejected, distinctHosts
hashNs, workNs, inputBytes, acceptedOutputBytes
firstAcceptedOutputDigest, differingAcceptedOutputDigests
acceptedWorkNsAfterFirstAccepted
```

`acceptedWorkNsAfterFirstAccepted` is an upper bound on potentially reusable CPU
work, not an elapsed-time speedup: rayon attempts overlap; the first accepted
result might not yet be available to a racing attempt. Also report concurrent
misses, clone/copy cost, and peak live accepted-value bytes before designing a
single-flight cache. A future single-flight implementation must avoid waiting on
the same key recursively, preserve resource budgets, and remain cancellable.

Actual-work census must live outside the route telemetry transaction, so failed
attempts remain counted. Existing `csg::take_csg_census()` measures kernel calls;
`stats.total_csg_failures` measures failures. They are different quantities.
`csg/source_topology.rs` records source subtraction calls, and
`telemetry_transaction.rs` explicitly preserves actual-work census on rejection.

## Exact key and value contract

Use model-job scope first. A source replacement creates a new namespace, even if
entity IDs are identical. Never key only by express ID, display name, dimensions,
representation identity, tolerance-rounded coordinates, or sampled positions.

The namespace must include or immutably fix these inputs:

- source snapshot identity, schema and geometry-output version;
- unit-scale bits, tessellation quality, exact/import mode and chord-tolerance
  bits (`P*0.25/unit_scale`), P bits, local-frame/RTC policy;
- skip-small-cuts, material/indexed-colour splitting and triangle-order policy
  when the cached boundary includes a decision affected by them;
- kernel SNAP_GRID, surface policy, prism-cut enablement, retry order/scales and
  any algorithm/acceptance-policy revision. Do not silently reuse across a new
  default or environment override.

For an authored Boolean key, serialize the operation and **ordered** operands with
length-prefixes and exact bit patterns. Include every `Mesh` field at the cache
boundary initially: positions/normals (`f32::to_bits`), indices, origin (`f64`),
rtc_applied, optional local_bounds/local_to_world, welded_in_object_frame,
plane_tags including every f64 normal and offset, and optional InstanceMeta.
`+0/-0`, optional None/Some, topology order and component order stay distinct.
Reject non-finite input from the reusable set. Do not normalize poses, reorder
vertices/indices, collapse normals, or quantize coordinates to manufacture hits.

This deliberately strict first key may retain fields not read by a particular
helper. Narrow it only after a separate read-dependency proof and regression.
If a cache boundary carries `SubMesh`, also include or separately restore its
geometry_item_id, UVs, texture and style associations; never reuse another item's
material or identity. A cache digest is an index: on collision compare exact
serialized inputs, or retain collision buckets that do so. A stronger hash alone
does not constitute an equality proof.

The Boolean key should be taken **before** the internal scale/shift retries, so
one successful entry can bypass that helper's retry sequence. The namespace fixes
that sequence. If instead caching a scaled internal kernel call, include the
actual scale, shift and scaled precision, and hash the actual post-rounding arrays.

Store only an explicitly accepted `Some(Mesh)` result after all gates belonging
to that helper, with its accepted output bits. Do not cache `None`, an unsupported
or budget-tripped result, an uncut recovery fallback, or
`cut_authored_solids(...).unwrap_or_default()` as a successful empty cut. A truly
accepted empty result is distinct; its hit must still mark the current host as
consumed through the normal per-host path. Check resource-budget status as well
as return type before publishing any entry.

The cache stores geometry, not a previous host's diagnostics or verdict. On a hit,
retain the normal per-host cut-effect recording and identity/style assignment,
then perform the existing source-frame cleanup/closure, `restore_precision_mesh`,
world closure and boundary verdict. Do not copy source_boundary_verdict,
voids_consumed_hosts IDs, CSG failure records, or telemetry from the first host.
Design explicit diagnostic replay rules; the existing ItemDedupCache documents a
cache-hit diagnostic omission (#4083), which a new cache must not repeat.

## Existing reuse and checks that must remain

- `router/processing.rs:957` looks up a structural item key before meshing and
  stamps its stored rep_identity. Cache insertion rejects empty meshes and
  budget-tripped builds. This established guard is relevant to the proposed
  precision namespace, but the new namespace cannot reuse normal-import entries.
- `router/brep_signatures.rs:45` folds quality/scale/RTC into structural keys.
  It does not encode P/chord tolerance; attaching a shared exact cache without
  a precision namespace is unsafe. Generic incomplete/refused BREP signatures
  cannot be published as completed model-wide signatures.
- `router/instancing.rs` already reuses eligible mapped source meshes, with
  restrictions for nested maps, failed/empty output, budgets and diagnostics.
  Do not turn an authored-frame mesh into a globally cached world mesh by source ID.
- `try_authored_all` already sorts by triangle count only when component
  independence is established; overlapping cutters preserve file order. A cache
  key must follow the actual operand order, not independently sort cutters.
- `source_validation::excludes_cutters` independently proves fallback subtraction.
  Re-meshing operands there might benefit from correctly scoped item reuse; the
  proof itself cannot be skipped just because the primary cut was cached.
- `instancing/group.rs:265` documents a measured direct representation-hash
  collision. It retains full index equality and per-vertex recomposition checks.
  The large InstanceMeta count does not authorize omitting them. Existing template
  self-reconstruction is already skipped. A generic verification cache would
  need the target arrays, template arrays, both origins, relative transform and
  baked basis in its key; different placements will often make keys unique.

## Regression plan before enabling any reuse

Run uncached versus cached through the same canonical production processing entry,
not through GeometryRouter without its normal RTC setup. Use the existing source
frame fixture/test seams; private-model tests skip clearly when their fixture is
absent. Build panic-isolating research harnesses with `server-release` if needed.

| Regression | Required assertion |
| --- | --- |
| Repeat identical strict operand pair/group | One accepted reusable entry; exact positions/normals/indices/origin/metadata match uncached output; diagnostic and host identity are correct on both calls. |
| Same shape under different host placement | Local reuse only when strict inputs match; restored world output equals each host's uncached bytes; no placement-memo leak. |
| Same representation at two P/chord values, quality values, scales and RTC policies | Different namespace/key; each result equals its own uncached run. |
| Same positions with different normals, topology order, origin, plane tags, or frame metadata | No false hit; all downstream output remains equal to uncached. |
| Deliberately forced hash collision | Full equality disambiguates; no mesh swap. |
| Ordered overlapping cutters; disjoint small/large groups | Same output/order and grouped/sequential fallback choice as uncached; no new sort. |
| Budget trip, unsupported/refused attempt, kernel rejection | No reusable success entry; a later fresh-budget valid call computes its own result. |
| Accepted complete consumption versus failed default empty | Only the accepted case reuses; host consumed state and absence/presence of material are preserved. |
| Frame cleanup failure after a local cache hit | World closure still runs; cache cannot turn rejection into success. |
| Warm decoder after failed attempt/unwind | Original world-placement memo restored; existing `nhip_unwinding_precision_scope_restores_real_geometry_on_a_warm_decoder` behavior remains. |
| Cancel/new file/new job while work is in flight | No stale cache publication/geometry into replacement job; no blocked waiter; no leaked snapshot or cache ownership. |
| Parallel identical misses | Same output bytes/diagnostic multiplicity as defined; no lock while processing; bounded memory; no recursion deadlock. |

For private-model validation, reuse the existing manufacturing cohort (including
hosts 10217, 198892, 714937 and the closed-stock/material checks in
`rust/processing/tests/nhip_real_manufacturing_cohort.rs`). Add paired cached/off
checks to those real-fixture paths rather than pinning a new source-text assertion.
Keep original geometry IDs, product IDs, style, triangle/mesh counts and complete
byte hashes; enforce stored manifold closure, material volume and void exclusion
in addition to byte identity. Normal bytes are part of render parity.

Only after a census shows reusable accepted work: compare base/branch interleaved
on an otherwise idle machine, with a fresh model job, and report canonical
meshing plus full packaged Ready/first-visible timings separately. Include cache
hash/lookup/copy time and memory. A filtered-kernel win is a candidate; only an
end-to-end run can establish a user-visible load-time win.

## Existing capture limitation

`research/nhip-fix-20261024/closed-operands-worst.json` contains 16 final output
meshes with positions, normals, indices, IDs and origin. It does not contain
ordered authored stock/cutter inputs, P, retry policy or the complete Mesh frame
metadata. It cannot be used to infer an authored-operand cache hit rate. No
diagnostic was run on that capture beyond listing its schema.
