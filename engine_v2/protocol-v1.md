# Engine V2 neutral chunk protocol

Engine V2 writes renderer-neutral artifacts. Neither Fragments nor Three.js types
may cross this boundary.

## Artifact lifecycle

The worker writes each build under a unique `*.partial` directory. It creates a
complete manifest only after every chunk passes its length, checksum, and coverage
checks. The cache promotes the directory with one atomic rename. A managed build
failure removes the partial output and leaves the active viewer model untouched.
An abrupt process termination can leave an unpromoted partial directory; readers
must ignore it, and production cache integration must scavenge it safely.

The cache key contains:

- source SHA-256;
- engine and protocol versions;
- IFC schema;
- geometry profile and tolerance;
- unit scale and origin policy.

## Manifest

`manifest.json` records source identity, coverage ledgers, base-mesh counts, chunk
order, byte lengths, and SHA-256 checksums. `complete` must be `true`. A reader
rejects an unknown version, a source mismatch, an incomplete ledger, a missing
chunk, or a checksum mismatch.

The current artifact manifest version is 5. The common chunk framing remains
protocol version 1; new tables use distinct chunk kinds rather than changing the
three P1 record layouts. The current P6.1 worker is `0.8.0-p6.1` with artifact
profile `m5-p2-e0.8.0-p6.1`.

Chunks use this 32-byte little-endian header:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | 8 bytes | ASCII `IFCV2CHK` |
| 8 | `uint16` | protocol version |
| 10 | `uint16` | chunk kind |
| 12 | `uint32` | header bytes |
| 16 | `uint64` | payload bytes |
| 24 | `uint32` | record count |
| 28 | `uint32` | flags; zero in v1 |

The manifest supplies the SHA-256 checksum; the binary header does not duplicate
it.

## Implemented chunk kinds

All records and scalar fields are little-endian. Offsets below are relative to a
record, after the common 32-byte chunk header.

### Kind 1: `PositionTable`

One 16-byte record per source or generated swept/direct-face-set geometry point:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `int32` | point Express ID; zero for a generated swept-solid vertex |
| 4 | `float32` | local X in IFC source units |
| 8 | `float32` | local Y in IFC source units |
| 12 | `float32` | local Z in IFC source units |

Triangle indices refer to zero-based position ordinals, not Express IDs. Kind 9
uses the same ordinal order and is the required renderer input; kind 1 remains for
P1/P2 compatibility and compact diagnostics.

### Kind 2: `MeshTable`

One 56-byte record per referenced base definition:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `int32` | base-definition Express ID |
| 4 | `int32` | representative product Express ID |
| 8 | `int64` | first index ordinal in kind 3 |
| 16 | `int32` | index count |
| 20 | `int32` | IFC face count |
| 24 | `int32` | expanded occurrence count |
| 28 | `uint32` | flags; zero in P3 |
| 32 | 3 x `float32` | local minimum X/Y/Z |
| 44 | 3 x `float32` | local maximum X/Y/Z |

### Kind 3: `TriangleIndexTable`

Each record is one `uint32` ordinal into kind 1. Every three consecutive records
form a triangle. A mesh's `first index` and `index count` select its contiguous
range.

### Kind 4: `InstanceTable`

One 112-byte record per expanded base-geometry occurrence:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `int32` | product Express ID |
| 4 | `int32` | base-definition Express ID |
| 8 | `int32` | direct base or `IfcMappedItem` Express ID |
| 12 | `uint32` | flags; bit 0 means mapped instance |
| 16 | 12 x `float64` | source-space affine 3x4 matrix, column-major |

The matrix stores the X, Y, and Z basis columns followed by translation. The
implicit final row is `[0, 0, 0, 1]`. Mapped instances use
`product placement × mapping target × mapping origin`, matching the audited
WebIFC 0.0.77 traversal.

### Kind 5: `ProductTable`

One 24-byte record per represented product:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `int32` | product Express ID |
| 4 | `int32` | `IfcProductDefinitionShape` Express ID |
| 8 | `int64` | first record ordinal in kind 4 |
| 16 | `int32` | instance count |
| 20 | `uint16` | source-local entity type ID |
| 22 | `uint16` | flags; zero in P3 |

Product ranges are contiguous and cover every instance exactly once. Selection
uses the product Express ID, not renderer object identity.

### Kind 6: `MaterialTable`

One 32-byte record per deduplicated renderer material:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `uint32` | zero-based material ordinal |
| 4 | `int32` | source `IfcStyledItem` Express ID, or zero |
| 8 | `int32` | source `IfcColourRgb` Express ID, or zero |
| 12 | `uint32` | flags: bit 0 default, bit 1 transparent |
| 16 | 4 x `float32` | linear source R/G/B and alpha |

Alpha is `1 - Transparency`, matching WebIFC 0.0.77. The current assignment
precedence is base representation-item style, mapped-item style, then the default
white material. Per-face and per-shell styles are not admitted. A defaulted
instance in a file with material associations marks material coverage as
`fallback-required` until that association path is implemented.

### Kind 7: `InstanceMaterialTable`

One `uint32` material ordinal per kind 4 record. Record counts must match exactly.
This separate table keeps the P2 instance layout stable while allowing different
mapped occurrences to select different materials.

### Kind 8: `TriangleNormalTable`

One four-byte octahedral normal per triangle, in kind 3 order:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `int16` | octahedral X, signed normalized |
| 2 | `int16` | octahedral Y, signed normalized |

The decoded vector is the IFC face normal used by WebIFC's indexed polygon path.
It remains defined for zero-area Earcut triangles, so the renderer must not infer
the shading normal from quantized absolute positions.

### Kind 9: `HighPrecisionPositionTable`

One 32-byte record per source or generated geometry point, in the same ordinal order as
kind 1:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `int32` | point Express ID |
| 4 | `uint32` | reserved; zero in P3 |
| 8 | `float64` | source X |
| 16 | `float64` | source Y |
| 24 | `float64` | source Z |

The renderer builds bounded triangle clusters from kind 9 in float64, subtracts a
cluster-local origin, verifies that nonzero source triangles survive conversion,
and only then uploads float32 positions. Absolute kind 1 positions are not a safe
GPU input for large-coordinate models.

### Kinds 10 and 11: semantic core

Kind 10 contains one 48-byte record for every represented product and connected
spatial ancestor. It stores Express ID, parent ID, type ID, represented-product
flags, and four offset/length pairs for GlobalId, Name, Description, and
ObjectType. Kind 11 is the deduplicated UTF-8 byte table addressed by those
pairs.

### Kinds 12 and 13: deep semantics

Kind 12 contains one sorted 24-byte record per represented product: Express ID,
zero flags, a `uint64` value offset, a `uint32` value length, and a zero reserved
field. Kind 13 concatenates the corresponding UTF-8 JSON records. Each bounded
record contains native type/material relations, property sets, quantities,
classifications, and normalized unit metadata. The browser downloads kind 12
once and range-reads only the requested record from kind 13.

## Units and viewer axes

The manifest records `lengthUnitScaleToMetres` and a 4x4 column-major
`sourceToViewerTransform`. For PVF, the scale is 0.001 and the transform maps IFC
`(X, Y, Z)` to viewer `(X, Z, -Y)` in metres. Instance matrices and position data
remain in IFC source units; the model transform is applied once at the boundary.

The current fast path accepts `IfcSIUnit` metre lengths with an optional SI prefix.
Conversion-based length units are not yet supported.

## P6.1 geometry coverage boundary

Manifest v5 now admits `IfcFacetedBrep`, `IfcShellBasedSurfaceModel`,
`IfcFaceBasedSurfaceModel`, `IfcTriangulatedFaceSet`, `IfcPolygonalFaceSet`, and
the declared `IfcExtrudedAreaSolid` profile families. Arbitrary profiles accept
polylines and connected, line-only indexed polycurves. Indexed arcs, composite
curves, nonzero unsupported fillets, booleans, and half spaces remain explicit
whole-model fallback conditions.

Direct face sets validate positive and in-range indices, optional `PnIndex`,
finite coordinates, planarity, nondegenerate rings and triangles, void
containment, ring intersections, Earcut area deviation, and bounded input sizes
before any complete artifact is published. A face set declaring `Closed=.T.`
must also be an oriented two-manifold triangle mesh. Optional per-vertex normals
are not representable in the current per-triangle normal chunk and therefore
select a precise fallback instead of being silently discarded. IFC4 releases
that use the older `NormalIndex` fifth attribute likewise fall back when that
payload is present; IFC4 Addendum 2 and IFC4.3 `PnIndex` lists are supported.

An unsupported verdict is not an artifact and cannot be served through the
chunk routes. It is a bounded atomic JSON cache entry keyed by source hash and
artifact profile. A matching verdict skips repeat worker work; a new profile
starts a new capability check, and successful artifact promotion deletes the
old verdict.

## Current artifact boundary and planned integration

P3 sets `viewerReady` to `true` only when geometry, transform, material, normal,
unit, and position-precision coverage are complete for the admitted profile. A
renderer must reject any artifact that does not explicitly declare itself
viewer-ready. The flag describes artifact completeness, not production
integration. Progressive delivery cannot be claimed until renderer scheduling,
cancellation, rollback, and disposal are implemented and tested.

## Required coverage

The PVF fast path must report all of these values before promotion:

- 411,192 represented products;
- 54,938 referenced base definitions;
- 2,790 referenced representation maps;
- 1,029,254 expanded artifact instances (the pre-expansion graph estimate is
  752,915 logical occurrences);
- zero missing references and zero unsupported geometry items.

Triangle totals are evidence, not the only correctness rule. P3 additionally
checks bounds, holes, winding, non-simple faces, complete base-definition coverage,
per-base triangle counts, product ranges, every expanded world bound, every
instance colour, and every packed face normal against WebIFC. Progressive GPU
rendering and packaged-WebView2 behavior remain open.
