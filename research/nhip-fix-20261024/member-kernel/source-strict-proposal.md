# Explicit finite-source policy on the existing kernel

This is a patch proposal, not applied production code. Preserve every existing
public default wrapper. No TLS, global flag, budget change, or second kernel.

## Policy

New `kernel/surface_policy.rs`, crate-private:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SurfacePolicy { ImportReconciled, SourceStrict }
impl SurfacePolicy {
    pub(crate) fn reconcile(self) -> bool { self == Self::ImportReconciled }
}
```

ImportReconciled is passed by every existing entry. SourceStrict is only passed
by source_topology's three finite-solid operations. Keep snapping/orientation,
exact predicates, arrangement, budgets and caller topology acceptance unchanged.

## Full propagation (all are explicit arguments)

1. `mesh_bridge::subtract_source_with_change(host,cutter)`:
   orient mesh_to_tris operands; **do not promote cutter**; call
   `difference_all_lenient_with_conformity_and_policy(&h,&[&c],SourceStrict)`;
   convert through existing tris_to_mesh_without_plane_tags.
2. `mesh_bridge::subtract_source_many(host,cutters)`:
   orient all mesh_to_tris operands independently; **do not promote**;
   call `difference_all_with_policy(&h,&refs,SourceStrict)`. Return Cut/Unchanged
   using the existing BatchSubtract semantics. On nonconforming return
   Nonconforming and let existing source orchestration use its sequential
   candidate; no lenient approximate volume oracle should re-enter default
   classification. An alternative sharing the existing volume-safe fallback
   MUST pass SourceStrict to both lenient difference and intersection oracle.
3. `mesh_bridge::union_source_many(meshes)`:
   budget::begin; orient mesh_to_tris independently; **do not mutually promote**;
   call `union_all_with_policy(&refs,SourceStrict)`; same output conversion and
   budget rejection. Source caller still validates exact closed output.
   The current preserve_coordinates boolean on union_source_meshes should be
   removed, and the redundant [true,false] retry loop in source_batch removed:
   no finite-source attempt should silently re-enable promotion.

Add the following arrangement functions, while old wrappers call these with
ImportReconciled. These signatures can remain pub(crate):

```rust
fn arrange_with_policy(a:&[Tri],b:&[Tri],policy:SurfacePolicy)->Arrangement;
fn arrange_many_with_policy(meshes:&[&[Tri]],policy:SurfacePolicy)->MultiArrangement;
fn boolean_with_conformity_and_policy(a:&[Tri],b:&[Tri],op:BoolOp,
    policy:SurfacePolicy)->(Vec<Tri>,bool);
fn difference_all_with_policy(a:&[Tri],comps:&[&[Tri]],
    policy:SurfacePolicy)->Option<(Vec<Tri>,bool)>;
fn difference_all_lenient_with_conformity_and_policy(a:&[Tri],comps:&[&[Tri]],
    policy:SurfacePolicy)->(Vec<Tri>,bool,bool);
fn union_all_with_policy(meshes:&[&[Tri]],policy:SurfacePolicy)->(Vec<Tri>,bool);
```

Both difference functions pass policy to `classify_difference`; this passes it
to `boolean_vids_components_with_policy`. Binary Boolean similarly passes it
to `boolean_vids_with_policy`, which wraps the same components implementation.
All existing wrappers, including boolean_topology_hash, stay default.

## Triangle intersection is part of this policy

`tritri::tri_tri_intersection` wraps a new crate-private
`tri_tri_intersection_with_policy(t1,t2,policy)`.
Only change its first near-coplanar branch:

```rust
if policy.reconcile() && near_coplanar(t1,t2) { return TriTri::Coplanar; }
// Existing exact plane_interval logic follows unchanged.
```

Both arrangement loops (binary at mod.rs~195 and N-ary at~302) call the new
function with policy. The strict branch still recognizes genuinely EXACT
coplanar faces through the existing PlaneInterval::Coplanar tail. Otherwise
near off-plane projected constraints could survive even with strict classifier.

## Binary/component classifier

The only accepted approximate classification changes are opt-in:

```rust
// BComponents::surface_normal(c,n,policy):
// Keep the existing exact-first loop unconditionally.
if policy.reconcile() {
    // Existing second loop using near_on_surface_normal.
}

// B-loop c_on_or_near_a: keep the existing exact on_surface_tri test.
on_surface_tri(c,t)
    .or_else(|| policy.reconcile().then(||near_on_surface_tri(c,t,&band)).flatten())
    .is_some_and(|n|coincident_planes(n_own,n))
```

To avoid an eight-argument helper/Clippy warning, pass
`a_band: Option<&NearBand>` instead of adding policy to c_on_or_near_a:
Some(&a_band) means existing reconciliation, None means exact-only. BVH may
still use the conservative existing band radius; only the acceptance predicate
is exact. No global cop_parent gating: that previously regressed 20+ default
hosts. For SourceStrict only, bypass regime2 finite `solid_side` offset probes:

```rust
// A side:
} else if let Some(k) = (policy.reconcile() && cop_parent).then(|| {
    // Existing solid_side implementation, unchanged.
}).flatten() { /* existing keep */ }
// B side:
if policy.reconcile() && cop_parent { /* existing on_interface_keep */ }
```

Exact coincident-surface normal ownership has already handled a real shared
boundary. Other conforming subtriangle centroids therefore use exact parity.
A parent-wide coplanar flag can be set by a different overlap on the same
original face, so it does not itself justify a finite probe at THIS centroid.
The finite probe may step over a true thin gap. Generic regime2 stays verbatim.

## N-ary union needs an extra strict branch

`union_all` currently probes at `centroid + normal*(extent/2^20)`. That finite
step can cross a real thin gap even without plane promotion. Strict union
should classify the centroid exactly against every other outward closed solid;
coincident faces get normal/owner handling. Keep the existing offset path
verbatim for ImportReconciled.

```rust
fn source_union_face_keep(c:[f64;3],n:[f64;3],owner:usize,
    meshes:&[&[Tri]],exts:&[f64],aabbs:&[Aabb])->bool {
    for (other,mesh) in meshes.iter().enumerate() {
        if other==owner {continue;}
        if let Some(other_n)=on_surface_normal(c,n,mesh) {
            // Opposed normals: internal interface. Same direction: exactly one
            // owner, independent of whether retriangulation uses identical Vids.
            if dot3(n,other_n)<=0. || other<owner {return false;}
        } else if point_inside(c,mesh,exts[other],aabbs[other]) {
            return false;
        }
    }
    true
}
```

Place this helper alongside classifier exact-surface utilities (or a small
new arrangement/strict_source.rs with narrowly shared helpers) so it reuses
the same exact coincidence/parity code. Generic union's existing oriented-Vid
dedup remains and is harmless after strict owner handling.

## Source call sites and tests

`csg/source_topology.rs`: all three methods must use the corresponding strict
bridge entry, including the formerly `preserve_coordinates=false` attempt.
Default subtract_mesh/group_cut/union_mesh stay on existing bridge functions.

Keep bridge strict APIs crate-private. Expose tiny wrappers in the existing
`#[cfg(any(test,feature="test-support"))] test_support` module for integration
tests; do not unnecessarily publish a new Rust API. Run the reproduction with
`--features test-support`, or move the portable invariant into a sibling unit
test where crate-private entry is visible.

Adapt nhip_finite_pocket_kernel.rs only at the operation entry to strict source
subtraction. Keep exact closed operands, four ray surfaces, both20–27um skin
assertions. Also add strict N-ary union disjoint-one-grid-gap and opposing-face
touch controls, plus batch pockets. Generic tests/snapshots must remain green.

This proposal has not been compiled or applied. Admission remains in existing
source_frame proof and post-hygiene manifold checks, not in these low-level
functions. This policy does not fix nonconforming arrangements, missing exact
parity robustness, source hygiene or budget exhaustion by assertion.
