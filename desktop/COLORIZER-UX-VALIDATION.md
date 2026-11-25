# Simplified Colorizer and desktop startup — 16 October 2026

Candidate: `release/10.3.0-native-colorizer-ux-20261016-r2/IFC-Lite.exe`.
SHA-256: `e7319fee48a596815605269e8cd310807d262f1b069a3911d885045c0a48f328`.
Built from the current dirty working tree on `codex/desktop-v10.3.0`, based on
`471284f476d64a659ae607eeec2115ca3afcb9fe`. Previous candidates were not replaced.

## Result

- **Author → Colorizer** reads the open IFC automatically. No **Prepare model**
  or **Regroup** button, and no requirement to enter the Model workspace.
- A single open IFC shows its filename; only multiple models show a file picker.
- The group list stays visible. Choose a colour and use **Apply colour**;
  **Save coloured IFC** stays in the footer. Transparency, palette tools and
  automatic colours are under **More options**.
- Repeating the Colorizer ribbon/rail action collapses that dock without opening
  Properties. The collapsed dock remains mounted, so reopening retains the draft.
- Local desktop startup collapses Hierarchy, ribbon and sidebar. It opens with
  a file-open/drop target instead of the welcome/demo/tour screen. The initial
  privacy toast is omitted in this local shell; privacy controls remain available.
  The browser's original welcome screen and startup defaults remain available.
- Ribbon height and opacity transition over 200/140 ms. Its contents stay
  mounted, hidden from focus while collapsed; reversing midway interpolates
  from the current height. Reduced-motion mode disables the transition.
- A copy export uses the shared permission checks without the edit-mode gate;
  shared-session roles and workflow locks still apply. Ordinary model mutations
  retain their edit-mode requirement. The Rust colour/export path is unchanged.

## Verification

Root Turbo typecheck passed, including the 3,260 test-file coverage audit. The
root Turbo Colorizer test shard passed all 12 tests: automatic source reading,
single-file layout, ordinary mutation/edit-mode isolation, viewer-role denial,
repeat panel toggles, the native start action, stale source, cancellation,
history, export transparency, five independent picks across different groups
and federated model offsets, and bounded native transport. Cancelled reading
has a working **Try again** action, covered by the cancellation test.

The actual EXE was launched in a fresh WebView2 profile. The run checked initial
collapsed flags, the minimal start screen, and absence of the initial toast
after four seconds. It loaded the real coloured hangar IFC and opened Colorizer
without entering edit mode. It painted gray then `PIPE-267.4X8` red, checked
undo/redo, collapsed/reopened the panel while retaining the draft, changed
grouping automatically, saved the complete IFC, and reopened it through native.
Both native geometry totals matched: 1,917,264 vertices / 1,681,800 triangles.
No page errors or console warnings were recorded in the final run.

On the loaded hangar model, each ribbon direction produced 15 intermediate
height frames. The observed p95 rAF interval was about 10.1 ms, maximum 10.5 ms.
The check also verifies reduced-motion CSS. These are local UI timing samples,
not a general GPU-performance or large-model smoothness qualification.
An additional run reversed direction four times with 45 ms pauses: 52
intermediate frames, largest height step 17.9 px and maximum rAF gap 20.0 ms.
See [the reversal trace](../research/colorizer-20261015/native-ribbon-stress/rapid-reversal.json).

The same packaged run then used five real Ctrl+click gestures on the 3D canvas,
selecting local IDs `58`, `145921`, `81179`, `159039`, `170012`. **Paint 3D
selection** changed precisely those five members. Independent readback of
`ui-five-selected.ifc` confirmed five red / 14,504 gray Body items, all 184,677
non-presentation records unchanged, and matching geometry on 11 samples.

The export download Blob was captured at the real download anchor rather than
confirming an OS save dialog. The input is the same 14,509-product IFC used in
the first [Colorizer validation](COLORIZER-VALIDATION.md). Independent readback
checks the actual new download: 1,968 red / 12,541 gray Body items, unchanged
184,677 non-presentation records, and matching vertices/triangles on 12 samples.

Evidence:

- [Packaged run](../research/colorizer-20261015/native-ux/report.json)
- [Initial screen](../research/colorizer-20261015/native-ux/01-startup.png)
- [Simplified Colorizer](../research/colorizer-20261015/native-ux/02-colorizer.png)
- [Collapsed panel](../research/colorizer-20261015/native-ux/03-closed.png)
- [Independent readback](../research/colorizer-20261015/native-ux/oracle.json)
- [Five-selection readback](../research/colorizer-20261015/native-ux/five-selection-oracle.json)
- [Real selection gestures](../research/colorizer-20261015/native-ux/selection-gestures.json)
- [Ribbon close frames](../research/colorizer-20261015/native-ux/ribbon-collapse.json)
- [Ribbon open frames](../research/colorizer-20261015/native-ux/ribbon-expand.json)

Changed UI files pass lint and the i18n/module-size/source-assertion checks.
The existing whole-repo accessibility ratchet still reports three warnings in
untouched `ViewCube.tsx`; no baseline or threshold was weakened. The earlier
broader quantity/rebar and server-Clippy failures remain outside this UI change.

Limits: export transparency is reviewed by reopening the file; preview uses
opaque overlays. Replacing the source or switching to a different panel can
discard the draft. Large-model memory/performance and the user's MaiSanh file
have not been qualified by this run. No code was committed or pushed.
