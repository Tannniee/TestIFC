---
"@ifc-lite/wasm": patch
---

Handle Reference geometry consistently across subtraction features, retain real
Body cuts, and keep their optional overlays under the opening visibility toggle.
For proven through-cut extrusions, preserve holes, boundary notches and every
disconnected component using a guarded planar difference before re-extrusion.
Keep blind and oblique manufacturing cuts finite in the authored stock frame,
and refine supported profile curves against the source context's Precision.
Preserve thin material skins through coordinate conversion with zero-area-only
cleanup and exact boundary subdivision, requiring closed stored geometry.
