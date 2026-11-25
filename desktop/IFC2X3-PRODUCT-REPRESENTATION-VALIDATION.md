# Legacy IFC2X3 product representation loading

The reported HEINEKEN IFC2X3 file contains 7,215 entities and 502 steel
products. Its 502 Body/SweptSolid shapes are held in `IfcProductRepresentation`
containers rather than `IfcProductDefinitionShape`. The original packaged
native viewer rejected these containers and returned no renderable geometry.
The input is only 359,864 bytes; this failure is unrelated to the WASM memory
limit.

The IFC2X3 base entity has the same Name, Description, Representations layout
as its shape subtype. See the official
[IFC2X3 definition](https://standards.buildingsmart.org/IFC/RELEASE/IFC2x3/TC1/HTML/ifcrepresentationresource/lexical/ifcproductrepresentation.htm).
The shared Rust router now accepts both containers, while retaining the
existing child geometry filters and rejecting material representation
subtypes. Normal/submesh processing, RTC discovery and material-layer routing
use one predicate; no separate desktop geometry engine was introduced.

## Evidence

- The exact previously delivered OLED/native EXE failed on the original file
  with `Native IFC returned no renderable geometry`.
- A separate diagnostic copy, changing only the 502 container type names to
  the subtype, loaded all 502 meshes in that same EXE. The original file was
  preserved, including its SHA256.
- Five regression tests cover normal/submesh equivalence, large coordinate
  anchors, near-origin RTC discovery, canonical processing and material
  representation rejection. Three failed before the production fix; all five
  pass after it.
- All 17 desktop Rust tests pass. Desktop all-target Clippy with warnings
  denied passes.
- Broader geometry/processing library suites have two unrelated failures in
  unmodified tests: their LF-only fixture insertion markers do not match CRLF
  files on Windows. Geometry: 1,185 passed, one failed, one ignored;
  processing: 453 passed, one failed, one ignored. These suites are not
  reported as fully passing and no test was disabled.
- The EXE build was stopped at the user's request. The patched original file
  has **not** been validated in a new packaged EXE; the previously delivered
  EXE is unchanged.

Local diagnostic logs live in ignored `desktop/reports/`. No private IFC
content is checked into the repository. After an explicitly requested future
build, `desktop/ifc-model-smoke.mjs` can check an external IFC through the actual
packaged native loader using `SMOKE_EXE`, `IFC_MODEL_FILE` and optional
`IFC_EXPECT_MESHES` environment variables.
