# TestIFC v2.0.1 source publication

Published to Tannniee/TestIFC main at the user's request. This snapshot updates
main while preserving its previous commit history and the v2.0.0 tag.

## Source identity

- Audited source: 13e402c42884c479fc22437c2e8f7a8c5dad53c5.
- Prior TestIFC main: bb823f5047360e04acaf4962cbca2ab9b0059006.
- Upstream package source: 61d209288c1b117d405628ead302d0ee700bd2a0.
- Publication tag: v2.0.1. Package versions retain their actual identities:
  custom viewer 4.0.0, desktop host/WASM 10.4.0, Rust workspace 20.4.0.
- Complete workspace catalogue: 62 packages, including 57 published packages.

## Preserved custom behavior

The native Windows host, geometry transport, cooperative loading, native instancing,
bounded picking, Colorizer with persistent IFC export, fixed canvas and panel docking,
TestIFC navigation/ViewCube/section tools, federation and GIS retain their custom
implementations. The upstream web interface is not substituted for this viewer.
The upgrade includes the matching source, manifests, lockfiles, tests and API guides.

## Qualification already completed before publication

The prior audit completed root typechecking (120 tasks), Windows lint with zero
errors, composite complete-package coverage (22,410 passed; 164 conditional skips),
855 viewer cases with one existing external-fixture skip, and Rust workspace tests
(4,797 passed; 41 existing ignored tests). The pinned nightly Clippy check passed.
Registry audits reported zero known npm vulnerabilities; patched Rust closures
reported zero vulnerabilities with an existing async-std maintenance notice.

The delivered local executable passed 99 native quality/navigation/interaction groups,
including strict two-model section-box gestures. Persistent IFC recoloring/export
and representative large-model loading were checked on private inputs. These are
prior recorded results, not checks run during this publication. The historical
first Box failure's cause remains unproven; current strict retakes passed.
Unknown vertical CRS datum, storage-volume flush requirements for BCF, three missing
optional Rust BOS tables, and untested external corpus coverage remain documented limits.
Raw private evidence and executables remain local. This snapshot makes no new
geometry, performance or all-corpus correctness claim.

## Source-only publication; automation disabled

No build, dependency installation, test execution or GitHub Actions run is part of
this publication. Repository Actions permissions are disabled before the push.
All 33 workflow definitions are archived under
.github/workflows-disabled/ with a .disabled suffix; .github/workflows/ is empty.
The publication commit also carries [skip ci]. Composite-action sources are retained
for reference but have no active invoking workflow.

Private input models, raw local reports, research directories, executables, installers,
compiler outputs, dependency directories, caches and generated WASM runtime files
are excluded. Public upstream fixtures and source assets remain. The committed
WASM type declarations remain available for source typechecking. Original sources,
private models and old executable deliveries are not modified by publication.

The upstream MPL-2.0 license, notices and package attributions are retained.
