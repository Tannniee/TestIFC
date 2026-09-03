import assert from "node:assert/strict";
import test from "node:test";
import { loadProgressValue, isOpeningModel } from "../src/lib/load-progress.ts";

const event = (stage, progress, phase) => ({ loadSequence: 1, modelHash: "hash", stage, progress, phase });

test("load progress keeps phase resets separate from overall progress", () => {
  const decompressed = loadProgressValue(event("loading", 1, "decompressing"));
  const parsing = loadProgressValue(event("loading", 0, "parsing"));
  const generating = loadProgressValue(event("loading", 0, "generating"));
  assert.equal(decompressed.overall, parsing.overall);
  assert.ok(generating.overall > parsing.overall);
  assert.equal(parsing.step, 0);
  assert.equal(loadProgressValue(event("converting", .675, "attributes")).step.toFixed(2), "0.50");
});

test("unknown work stays indeterminate and never fabricates completion", () => {
  for (const stage of ["hashing", "cache", "finalizing"]) {
    const state = loadProgressValue(event(stage));
    assert.equal(state.step, undefined);
    assert.ok(state.overall < 100);
  }
  assert.equal(loadProgressValue(event("loading", 1, "done")).overall, 95);
  assert.equal(loadProgressValue(event("ready")).overall, 100);
  assert.equal(isOpeningModel(event("cancelled")), false);
  assert.equal(isOpeningModel(event("error")), false);
  assert.equal(loadProgressValue(event("reading", NaN)).step, undefined);
});
