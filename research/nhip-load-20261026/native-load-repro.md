# Native load reproduction and regression plan — 2026-10-26

Scope: read-only reconnaissance of `F:/Steel/VBA/IFC-Lite-Core104`. No production
file was changed, no model was run, no existing application was opened/closed,
and no cache was created or removed by this work.

## Concrete pipeline facts

- `apps/viewer/src/hooks/useIfcLoader.ts:686`: native `.ifc` dispatch enters
  `loadNativeIfcModel`, then returns before the ordinary browser cache lookup.
  `apps/viewer/src/hooks/ingest/nativeIfcLoad.ts` preserves the canonical
  `loadFile(file, target)` finalizer for both primary and federated models.
- `desktop/native-bootstrap.ts` lazily constructs `createNativeIfcRuntime` with
  the current `__TAURI_INTERNALS__.invoke` on every load.
- `desktop/native-client.ts`: every load creates a fresh job, copies the source
  into it in 2 MiB chunks, starts geometry, drains IFCD/IFNS/IFCB, applies final
  colours, prepares/receives semantics, then returns the complete result.
  It does not look up or write a persistent native cache.
- `desktop/src-tauri/src/native.rs`: geometry reads the temporary snapshot into
  a Rust buffer and calls the canonical streaming producer with batch sizes
  16/4096, `retain_emitted_meshes=false`. Its callback synchronously runs
  `partition::encode` and sends through a **two-packet** bounded queue. A full
  queue sleeps 5 ms between retries. The reported processing/geometry wall time
  therefore contains callback partitioning and producer backpressure; it is not
  pure meshing time.
- `desktop/src-tauri/src/packet_batches.rs`: geometry packet target is **8 MiB**.
  A single oversized source mesh is kept whole. This differs from the 2 MiB
  source/semantic chunk size and is not a model-size cap.
- `desktop/src-tauri/src/semantic_model.rs`: semantic preparation happens after
  geometry drains. It rereads the same snapshot, extracts the rooted model,
  serializes records to a temporary file, then `native-semantics.ts` decodes
  bounded packets into columns/maps. This is a separate scan/extraction, but
  source alone does not establish that it dominates the elapsed load.
- Current GPU registration follows the complete native result, not each native
  packet. Therefore Rust's first emitted mesh is not the first visible model.
  The first Ready signal also does not establish that queued GPU uploads and
  fragment consolidation have settled.

## Instrumentation harness

`native-load-repro.mjs` attaches to an **explicit existing diagnostic session**.
It installs wrappers, but never invokes Open/Load or changes the viewer state.
The parent can use the usual UI load afterwards:

```powershell
node research/nhip-load-20261026/native-load-repro.mjs install research/<cohort>/session.json
# Open the original IFC through the ordinary file input in that diagnostic app.
node research/nhip-load-20261026/native-load-repro.mjs status research/<cohort>/session.json
node research/nhip-load-20261026/native-load-repro.mjs export research/<cohort>/session.json research/<cohort>/native-rpc.json
node research/nhip-load-20261026/native-load-repro.mjs uninstall research/<cohort>/session.json
```

The script records RPC start/end, size and IFCD/IFNS/IFCB magic without retaining
source/geometry buffers. It records native progress and the final stats/counts,
plus visibility contamination. Full call rows are bounded; aggregate counters
continue after the row bound. Export reports dropped rows explicitly. Hooks
refuse overlapping loads or removal during a load. Do not treat this as a
production module or an invoked CI gate.

Interpretation:

1. `native_append_source`: ingress/IPC, alongside File-slice overhead in the gaps.
2. First `native_start_job` → done/final drain: canonical geometry + partition +
   IPC backpressure + JS packet decode. Do not add their overlapping totals.
3. `native_prepare_semantics`: Rust source read + semantic extraction + spool.
4. Semantic packets/gaps: IPC versus JS UTF-8/record decode and intentional yields.
5. Native result returned → GPU queue empty/finalize false: frontend store/index
   construction, registration, GPU upload and consolidation; measure separately
   with the existing viewport diagnostics.

The parent's `nhip-load-timing` mesh-only/packet controls isolate producer versus
partition/encoding without transport. Pair them with these RPC intervals to
localize a cold-open bottleneck. A synthetic invocation stub cannot establish
the real-model speed; no such test is offered as evidence here.

## Cold-open and repeat-open levers

1. **First attribution, then cold-open changes.** Compare canonical mesh-only,
   packet-without-IPC, normal native RPC and GPU-settled times. The existing
   `native_import_path` can avoid JS source copying when a trustworthy absolute
   path is available, but `File.name` is not that path. Do not hard-code a model
   path or bypass canonical loading. Source upload may be a small phase.
2. **Native repeat-open cache is currently absent.** Replaying validated native
   geometry packets plus semantic records could remove repeated meshing and
   rooted extraction while keeping existing decoders/finalization. This is a
   separate warm-open claim, not proof of faster first opens.
3. **Reuse cache identity principles, not the browser's key unmodified.**
   `hooks/geometryCacheKey.ts` combines format/output revision and geometry
   options; `@ifc-lite/cache` is format 25 in this checkout. Its sampled source
   fingerprint is explicitly a lookup key, not full content validation. A
   native packet cache must additionally distinguish the producer build/output
   policy and native packet ABI, basis/RTC/instancing contracts, semantic scope
   and semantic schema. Native currently ignores the browser cache branch.
4. **Earlier visible geometry is a different metric.** Streaming packets to the
   current finalizer could improve first visibility, but it needs the producer
   frame/RTC and federation identity before publishing the first piece. A new
   primary-only loader would violate the canonical-load contract. It does not
   remove CSG work or justify calling the model complete early.

## Concrete regression matrix for a native replay cache

Use real packet output from a small checked-in IFC fixture and a private Nhip
run; skip private fixtures when absent. Assert independent invariants rather
than grep source or assert a mock's return value.

| Trigger | Required invariant |
| --- | --- |
| Fresh parse then replay | Ordered packet bytes/magic, counts, f32 positions/normals/indices, f64 origins, IDs, colours/finishes, item IDs and IFNS transforms unchanged. |
| RTC/site-rotated/metre + millimetre sources | Same world-space transformed vertices and bounds; exactly one Z-up→Y-up conversion; same unit scale. |
| Primary and federation, one and multiple models | Same canonical finalizer, model ownership and registry/global-ID resolution; no offset baked into reusable raw packets. |
| Same filename but changed source | Cache miss even for same size or restored mtime; validate full content hash, not just sampled fingerprint/name/mtime. |
| Same source but producer output revision/build, packet ABI or geometry options change | Cache miss. Do not accept engine version alone when local unversioned fixes change geometry. |
| Semantic scope/schema/units change | Miss or explicit independently versioned semantic miss; never mix cached geometry with unrelated properties/source. |
| Abort while source hashing, meshing, packet writing or semantic spooling | Close the job, unblock the two-packet producer, free buffers/handles; no completed entry published. |
| Process exit during write, truncated record, invalid lengths/hash | Atomic completion marker/rename; reject incomplete/corrupt entries and regenerate with a reported miss. |
| Two callers populate same key | One coherent completed entry; temporary files are independently owned; cancellation of one cannot delete another caller's entry. |
| Deferred style/feature display | Final colour updates replay exactly; Reference-only cutters remain absent and Body overlays stay optional/transparent. |
| Cache-hit native stats/UI | Explicit `from_cache=true` and separate read/decode/upload timings; no replay of stale extraction durations as current work. |
| GPU settle after hit | Not merely `loading=false`: no queued upload, no active finalize, then visible-frame/interaction evidence and eventual restored batches available. |

No performance number in this document is a measured result. The harness has
only been syntax-checked; the parent must install it before the next real load.
