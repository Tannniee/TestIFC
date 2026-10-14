# IFC-Lite source backup: v2.0.0

Source snapshot of IFC-Lite 10.3.0 with local native Rust desktop improvements,
cooperative loading, semantic extraction cancellation, native instance units,
250 ms navigation settling, Fast view, and the reviewed cleanup script.

This tag identifies a backup; package/application version fields retain their
existing values. TestIFC main is maintained separately.

Upstream: https://github.com/LTplus-AG/ifc-lite
Local base commit: 471284f476d64a659ae607eeec2115ca3afcb9fe
License: MPL-2.0; original notices and attribution are retained.

## Automation and artifacts

GitHub Actions definitions are archived under .github/workflows-disabled/
with .disabled extensions. There are no active files in .github/workflows/.
The commit and tag contain [skip ci]. No build or Actions run is requested.

EXEs, installers, compiler outputs, dependency folders, generated WASM,
private model inputs and local validation reports are excluded. Public
upstream test fixtures remain with the source so tests can be reproduced.

desktop/Clean-OldBuilds.ps1 is the cleanup helper for the original delivery
workspace. It checks the locally preserved executable hashes, so a fresh
source-only clone without those executables will safely refuse cleanup.

Build instructions are in desktop/README.md; builds are manual.
