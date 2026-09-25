# IFC Engine V2 — native geometry and semantics pipeline

The completed production-integration phase is documented in
[p4-plan.md](p4-plan.md). The completed P5 semantic and extrusion work is
recorded in [p5-plan.md](p5-plan.md). The coverage, pipeline, default-engine,
and IFC Viewer 1.1.0 release work is tracked in [p6-plan.md](p6-plan.md). P6.1
is complete, P6.2 is under validation, and P6.3 has not started.

The viewer now sends every IFC file within the 2 GB application limit through
Engine V2. The frontend no longer loads or packages WebIFC, its WASM files, or
the Fragments conversion worker. An unsupported representation stops the open
operation with a specific error and preserves the previous active model.

The worker memory-maps an IFC STEP file, calculates its SHA-256 digest, handles
multiline and unusually large entity records, creates a dense Express-ID index,
and writes renderer-neutral point, mesh, triangle-index, instance, product,
material, normal, high-precision position, semantic-record, and semantic-string
chunks. It writes chunks under a unique partial directory, verifies their
lengths and SHA-256 checksums, and promotes the directory only after complete
coverage.

The isolated `probe` path can index and inventory sources up to exactly 2 GiB
with 64-bit record offsets and a validated index checksum. The application now
admits up to 2,000,000,000 bytes (2 GB decimal). Files above 1 GiB use the
native `probe --check-graph` artifact path.
Graph planning and artifact writing still require 32-bit whole-source spans,
so exactly 2 GiB remains outside application admission. See
`research-2gib-native-no-webifc-20260923.md` for the evidence and limits.

Known unsupported results are stored as small atomic verdicts keyed by source
hash and artifact profile. Reopening the same source reports the verdict
without repeating native preflight. A successful native promotion removes any
stale verdict for that profile.

The current native fast path covers:

- `IfcFacetedBrep` and `IfcShellBasedSurfaceModel` base definitions;
- `IfcMappedItem` and `IfcRepresentationMap` reuse;
- local placements, 3D axis placements, and transformation operators;
- face bounds, polyloops, styles, and colours;
- per-instance material assignment and transparency;
- packed face normals and float64 positions for precision-safe GPU clustering;
- `IfcExtrudedAreaSolid` with rectangle, hollow rectangle, circle, hollow
  circle, I-shape (including supported inner fillets), and L-shape profiles;
- `IfcExtrudedAreaSolid` with polyline-backed arbitrary closed profiles and
  profiles with voids, plus line-only indexed polycurves;
- `IfcDerivedProfileDef` with a 2D translation, orthogonal axes, and uniform
  positive scale, and `IfcExtrudedAreaSolidTapered` for matching parameterized
  profiles without mirroring;
- unstyled material layer sets and layer set usage with the default appearance;
- `IfcTriangulatedFaceSet`, `IfcPolygonalFaceSet`, and
  `IfcFaceBasedSurfaceModel` direct geometry;
- auxiliary Axis/Curve representations, which are ignored rather than treated
  as missing render geometry.

The current worker is `0.8.9-p6.2`, with artifact profile
`m5-p2-e0.8.9-p6.2`. This profile invalidates older cached unsupported
verdicts. All 34 files in the 2026-09-25 `IFC Temp` corpus produced
viewer-ready artifacts in individual checks. Selective IfcOpenShell meshes
cover Boolean trees, invalid bounded faces, direct face sets, problematic
extrusions, swept disks, and revolved solids; those meshes remain inside the
Engine V2 artifact and renderer pipeline. Empty Boolean results omit their
visible product instance. The 255 MB Bison reference file opened in the
packaged WebView2 app in 26.87 seconds on an earlier cold run; see
`../benchmarks/results/ifc-corpus-20260925/coverage-report.md`.
The P6.2 worker `0.8.3-p6.2` additionally planned composite profile curves with
trimmed circular arcs, nonzero I-profile fillets, and a single difference against
an unbounded or polygonally bounded half-space. It reuses planned meshes during
chunk writing, caps generated-geometry planning at two workers on sources up to
256 MiB, and checks an internal dense-index v2 footer before graph and chunk
reads. The artifact container remains manifest v5. The native Boolean planner
still rejects nested trees and solid second operands because earlier parity
tests found real errors; the selective external kernel handles them. The
artifact profile `m5-p2-e0.8.3-p6.2` invalidated earlier P6.2 trial artifacts.
The worker accepts a verified IFC2X3 ratio-measure degree factor. Version 0.8.3
recovers only coplanar, nonintersecting disjoint face bounds as separate islands,
records each recovered face in the manifest, and still rejects intersecting or
nested bounds. The 1.91 GB AMTIEN model now produces a complete native artifact;
the four recovered faces match isolated IfcOpenShell geometry. Its cached
artifact opened in a real browser after the WebIFC removal; packaged WebView2
has been tested with a smaller IFC. See
`research-2gib-native-no-webifc-20260923.md` for the measured evidence.

P3 proves topology, triangle counts, product ranges, instance transforms, units,
world bounds, material colours, and face normals for the PVF benchmark. P4 adds
the artifact cache, opt-in spatial-page renderer, transactional activation,
cancellation, fallback, feature adapters, and packaged-WebView2 validation. P5
adds artifact-native identity, type, hierarchy, basic attributes, properties,
quantities, classifications, type relations, materials, and normalized units.
Deep values are range-read per selected product; Engine V2 no longer starts the
Python/IfcOpenShell semantic index.

Engine V2 is the only viewer geometry path for every accepted file size.
Unsupported or unverified representation families fail the open operation
without displaying incomplete geometry. A medium IFC4X3 corpus model currently
fails this gate because it contains nested booleans; see the P6.2 parity audit
in [p6-plan.md](p6-plan.md). Broader geometry coverage, performance, lifecycle,
and packaged release gates remain open.

Build and test:

```powershell
dotnet build .\engine_v2\IfcEngineV2.Scanner\IfcEngineV2.Scanner.csproj -c Release
dotnet run --project .\engine_v2\IfcEngineV2.Scanner -c Release -- self-test
```

Tessellate a model without changing the production cache:

```powershell
dotnet run --project .\engine_v2\IfcEngineV2.Scanner -c Release -- scan `
  "F:\path\model.ifc" `
  --manifest ".\benchmarks\results\engine-v2-p3\scan.manifest.json" `
  --index ".\benchmarks\results\engine-v2-p3\model.ifc2idx" `
  --chunks ".\benchmarks\results\engine-v2-p3\chunks"
```

The desktop and normal `scan` command admit up to 2 GB decimal. Larger files are
rejected before mapping or allocating an index; the isolated inventory probe can
reach exactly 2 GiB. The current native path requires
an SI metre length unit, with or without an SI prefix; other length-unit forms must
remain on the fallback path until implemented.

The renderer must use `positions-f64.ifcv2`, form bounded triangle clusters in
float64, subtract a cluster-local origin, and only then convert positions to
float32. It must not upload the absolute `positions.ifcv2` coordinates directly.
Six exceptionally thin PVF triangles still collapse after the best per-triangle
float32 rebase; the equivalent WebIFC output contains 3,436 zero-area float32
triangles. The loader must count and report any such primitives rather than hide
them in the coverage ledger.

Run three fresh worker processes and capture phase timings, artifact checksums,
and peak memory:

```powershell
.\engine_v2\benchmark_engine_v2.ps1 `
  -Source "F:\path\model.ifc" `
  -Output ".\benchmarks\results\engine-v2-p3-model" `
  -Runs 3
```

The benchmark requires a new output directory so results and artifacts from
different runs cannot be mixed. Each process is application-cold; Windows may keep
the source file in its filesystem cache between runs.

Diagnostic parity checks require the repository's installed frontend
dependencies:

```powershell
node .\engine_v2\measure_webifc_triangles.mjs "F:\path\model.ifc"
node .\engine_v2\compare_non_simple.mjs `
  "F:\path\model.ifc" `
  ".\benchmarks\results\engine-v2-p3\chunks" `
  --all
node .\engine_v2\compare_instances.mjs `
  "F:\path\model.ifc" `
  ".\benchmarks\results\engine-v2-p3\chunks"
node .\engine_v2\compare_materials.mjs `
  "F:\path\model.ifc" `
  ".\benchmarks\results\engine-v2-p3\chunks"
node .\engine_v2\compare_normals.mjs `
  "F:\path\model.ifc" `
  ".\benchmarks\results\engine-v2-p3\chunks"
node .\engine_v2\validate_renderer_positions.mjs `
  "F:\path\model.ifc" `
  ".\benchmarks\results\engine-v2-p3\chunks"
```

These scripts are audit tools, not production inputs. See `p1-results.md`,
`p2-results.md`, `p3-results.md`, and `p5-plan.md` for the PVF evidence, and
`protocol-v1.md` for the binary container layout. The production manifest is
version 5 and the current worker is `0.8.3-p6.2`.
