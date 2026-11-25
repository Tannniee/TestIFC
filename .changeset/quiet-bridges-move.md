---
"@ifc-lite/renderer": patch
---

Prepare evicted GPU batches cooperatively across background tasks instead of
rebuilding a complete quantized/LOD batch in the animation callback. Keep
one restore in flight and publish only into its current scene/bucket; cancel
obsolete work on clear or device recovery and release unpublished resources.
