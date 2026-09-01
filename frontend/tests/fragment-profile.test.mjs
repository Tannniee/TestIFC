import assert from "node:assert/strict";
import test from "node:test";

import {
  configureFragmentImporter,
  fragmentCacheKey,
  resolveFragmentMetadataProfile,
} from "../src/lib/fragment-profile.ts";

function callsFor(profile) {
  const calls = [];
  configureFragmentImporter(
    {
      addAllAttributes: () => calls.push("attributes"),
      addAllRelations: () => calls.push("relations"),
    },
    profile,
  );
  return calls;
}

test("fragment A/B profiles map to explicit importer features", () => {
  assert.deepEqual(callsFor("full"), ["attributes", "relations"]);
  assert.deepEqual(callsFor("attributes"), ["attributes"]);
  assert.deepEqual(callsFor("minimum"), []);
});

test("query profile wins and full remains the safe default", () => {
  assert.equal(resolveFragmentMetadataProfile("?fragmentProfile=minimum", "full"), "minimum");
  assert.equal(resolveFragmentMetadataProfile("", "attributes"), "attributes");
  assert.equal(resolveFragmentMetadataProfile("?fragmentProfile=unknown", null), "full");
});

test("fragment cache identity includes format version and profile", () => {
  assert.equal(
    fragmentCacheKey("abc", "attributes"),
    "abc.fragments-v2-attributes",
  );
});
