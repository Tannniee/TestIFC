# Colorizer implementation contract

Approved scope: integrate the existing Colorizer workflow into our native IFC Lite host. Load an already coloured IFC, paint the model gray, paint a section/group/selection red, and export a new full IFC. Use Rust; no Python or IfcOpenShell runtime dependency.

The authoring tool previews a draft with local Undo/Redo and restores its owned overlay when dismissed. Its explicit export writes that draft with the canonical Rust STEP mutation-log exporter. Existing property/entity/georeference edits are included. Source identity and mutation revision are checked before publishing a catalog or download. Isolation and search do not filter the exported model.

The heavy source snapshot is uploaded in bounded chunks only when the tool is opened. Loading geometry remains unchanged. Native outputs are read in bounded chunks and temporary sessions are closed on cancellation/disposal. No implicit fallback to WASM or external services.

Rust owns section discovery, source graph ownership, copy-on-write representations, persistent styles and schema handling. The viewer owns controls, final per-product draft colours, history and a named overlay. The native bridge is transport only. The core is portable; a browser without a matching colourizer runtime must state availability explicitly.

Acceptance: real precoloured hangar IFC; gray then PIPE-267.4X8 red; selective shared maps; existing leaf styles; indexed colours/textures; IFC2X3 transparency; property edits preserved; unchanged source/world geometry; cancellation and stale-source refusal; model-specific IDs in a federation. Geometry load path has no new work. Measure opt-in export cost separately and do not claim a load speedup.

Implementation order: Rust authoring/export + behavioral tests → native session transport → viewer tool and panel entry → typecheck/test/build and independent IFC readback. Do not commit or publish unrelated working-tree changes or overwrite existing releases.
