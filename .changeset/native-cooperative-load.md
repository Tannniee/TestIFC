---
"@ifc-lite/data": minor
"@ifc-lite/renderer": patch
---

Expose `RelationshipGraphBuilder.buildSteps()` so large bidirectional CSR indexes
can be prepared across UI turns while preserving the synchronous `build()` API.
Slice large streaming geometry packing, quantization and LOD preparation through
the same numeric implementation, with cancellation and owned GPU cleanup before
publishing a complete batch. Preserve placement changes during preparation.
