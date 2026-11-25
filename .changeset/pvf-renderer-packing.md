---
"@ifc-lite/renderer": patch
"@ifc-lite/spatial": patch
---

Reduce temporary allocations in instance packing, camera movement and GPU batch staging while preserving instance matrices and f64 relative-to-eye precision. Build spatial indexes from compact, owner-scoped instance bounds without expanding their shared triangles.
