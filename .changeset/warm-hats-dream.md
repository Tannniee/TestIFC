---
"@ifc-lite/data": minor
"@ifc-lite/cli": patch
"@ifc-lite/encoding": minor
"@ifc-lite/export": minor
"@ifc-lite/geometry": minor
"@ifc-lite/ifcx": patch
"@ifc-lite/load-trace": minor
"@ifc-lite/mutations": minor
"@ifc-lite/parser": minor
"@ifc-lite/pointcloud": minor
"@ifc-lite/renderer": minor
"@ifc-lite/spatial": patch
"@ifc-lite/wasm": minor
"@ifc-lite/wasm-lifecycle": patch
---

Integrate the production 10.4 core and its runtime dependency closure while
preserving the custom desktop native bridge, cooperative upload, BVH picking,
TestIFC navigation and Colorizer export contracts. Keep the viewer UI on its
custom 4.0 line. Rebuild WASM from the matching Rust 20.4 source and update the
public API snapshot; existing TypeScript exports remain available.


