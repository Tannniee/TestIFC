# Phase 4-5 cache and take-off contracts

Semantic index v2 introduced the hot/cold split. Semantic v3 retains that split
and adds FTS5 search. Identity, tree, and search data publish first. Psets and
quantities populate `element_cold` afterward. A cold-index failure leaves the
hot index readable and appears through `/model/runtime`.

The facts cache stores density-independent `PartFacts` under:

```text
<model-hash>.facts-v1.sqlite
```

Each row includes `algorithm_version`. Changing the algorithm invalidates the
row without rebuilding fragments or the semantic index. Density tables,
tolerance, exclusions, and request policy never enter this cache.

Take-off schema v6 resolves mass in this order:

1. Authored weight.
2. Density multiplied by authored `NetVolume` or `GrossVolume`.
3. Density multiplied by supported analytic IFC geometry.
4. Density multiplied by supported FacetedBrep/mesh volume.
5. Density multiplied by the legacy section-text volume.

The first analytic slice supports `IfcExtrudedAreaSolid` with rectangle,
rectangle-hollow, circle, circle-hollow, and simple I profiles; it also supports
`IfcSweptDiskSolid` over `IfcPolyline` and mapped/scaled analytic items. Every
value preserves source entity IDs, method, units, volume, density revision, and
component provenance.

Unsupported analytic items now enter one bulk Geometry Iterator pass. The
tessellated volume is cached with `geometry_iterator` provenance before the
legacy section-text fallback. Broader IFC2x3/IFC4 project golden results remain a
release gate so fallback geometry cannot silently change mass.
