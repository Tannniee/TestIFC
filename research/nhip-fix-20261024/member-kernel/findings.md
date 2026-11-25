# #473164 finite-pocket kernel reproduction

The protected original was read only. `plate-473164.ifc` is a dependency-only
extract. `structure.json` and `*-oracle.json` came from IfcOpenShell 0.8.5 with
world coordinates, transformed into the exact host extrusion frame in f64.

Stock thickness is 10.04735279 mm. First three source cutters are 10 mm deep
and leave bottom 23.67127 um and top 23.67985 um skins (first cutter). There are
two skins, rather than a single 47 um skin. Full IfcOpenShell subtraction treats
these sub-Precision skins as coincident: a ray at x=.50038429 m, y=1.4 m has no
hits in the full oracle, despite four surfaces being required by the finite
authored operands. The independent finite-solid invariant is therefore more
precise than this full-oracle Boolean for this case.

`cargo test -p ifc-lite-geometry --test nhip_finite_pocket_kernel -- --nocapture`
reproduces the defect in debug in about 10 ms after compilation. Private real
operand test skips when research operands are absent; the two-box reduction
has no private fixture dependency.

At 16 work units/metre, subtracting cutter 473177 from the oracle stock gives
closed output. Second cutter 473183 produces eight bad stored-f32 edges. Both
operands are closed before and after independent mesh_to_tris snapping. Direct
arrangement without plane promotion still produces four bad edges with
conforming=true. The same four edges already exist in f64, before output f32
conversion. Thus neither source closure, independent snapping, f32 output nor
unrecovered constraints explains the missing cap.

The four direct-arrangement bad edges bound the second cutter's outer Y cap:
y=1.5 m, x=[1.2003841400146484,1.300384521484375] m,
z=[-.010024070739746094,-.00002384185791015625] m.
The snapped host Y maximum is 1.5000009536743164 m: a positive ONE-grid gap in
the scaled work units. The classifier's near shared-surface branch drops the
inner cap despite there being no intersecting constraint on that parallel
face. A reduction to two exact-grid nested boxes produces the same four-edge
hole with conforming=true.

Do not globally gate near classification by coplanar parent flags: existing
classify.rs documents that proposal regressed over 20 prior corpus hosts and
two clash oracle invariants. A source-only exact-coincidence policy is a
candidate mechanism: actual positive gaps must keep their boundary surfaces,
while the established approximate policy remains available for ordinary
f32-import flush-face reconciliation. This is a proposal, not an implementation.

Logs: kernel-red-snap-audit.log, kernel-red-output-audit.log,
kernel-red-edge-audit.log, kernel-reduced-one-grid-red.log.
