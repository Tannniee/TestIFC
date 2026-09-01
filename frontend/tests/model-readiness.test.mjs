import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGeometryProgress,
  applySemanticProgress,
  beginModelLoad,
  geometryReady,
  semanticReady,
} from "../src/lib/model-readiness.ts";

test("stale callbacks cannot replace the current model readiness", () => {
  const current = beginModelLoad(2, "B.ifc");
  const stale = applyGeometryProgress(current, {
    loadSequence: 1,
    modelHash: "hash-a",
    stage: "ready",
  });
  assert.equal(stale, current);
  assert.equal(geometryReady(stale), false);
});

test("model hash binds geometry and semantic progress to one load", () => {
  let state = beginModelLoad(3, "C.ifc");
  state = applyGeometryProgress(state, {
    loadSequence: 3,
    modelHash: "hash-c",
    stage: "ready",
  });
  const mismatched = applySemanticProgress(state, {
    loadSequence: 3,
    modelHash: "hash-d",
    stage: "ready",
  });
  assert.equal(mismatched, state);
  assert.equal(geometryReady(state), true);
  assert.equal(semanticReady(state), false);
});

test("semantic failure leaves ready geometry available", () => {
  let state = beginModelLoad(4, "D.ifc");
  state = applyGeometryProgress(state, {
    loadSequence: 4,
    modelHash: "hash-d",
    stage: "ready",
  });
  state = applySemanticProgress(state, {
    loadSequence: 4,
    modelHash: "hash-d",
    stage: "error",
    detail: "index failed",
  });
  assert.equal(geometryReady(state), true);
  assert.equal(semanticReady(state), false);
  assert.equal(state.semantic.detail, "index failed");
});
