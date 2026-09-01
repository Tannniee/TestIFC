import assert from "node:assert/strict";
import test from "node:test";

import {
  markViewerCreated,
  markViewerDisposed,
  resetViewerLifecycleDiagnostics,
  viewerLifecycleSnapshot,
} from "../src/lib/lifecycle-diagnostics.ts";

test("viewer lifecycle diagnostics track active instances", () => {
  resetViewerLifecycleDiagnostics();
  markViewerCreated();
  markViewerCreated();
  markViewerDisposed();
  assert.deepEqual(viewerLifecycleSnapshot(), {
    created: 2,
    disposed: 1,
    active: 1,
  });
});
