import assert from "node:assert/strict";
import test from "node:test";

import {
  API_ENDPOINTS,
  API_PROXY_PREFIXES,
  apiPath,
} from "../src/lib/api-contracts.ts";

test("API paths encode route parameters without changing the manifest", () => {
  const endpoint = API_ENDPOINTS.activateModel;
  assert.equal(
    apiPath(endpoint, { modelHash: "hash with/slash" }),
    "/model/activate/hash%20with%2Fslash",
  );
  assert.equal(endpoint.path, "/model/activate/{modelHash}");
});

test("proxy prefixes are unique and cover every endpoint family", () => {
  assert.equal(new Set(API_PROXY_PREFIXES).size, API_PROXY_PREFIXES.length);
  for (const endpoint of Object.values(API_ENDPOINTS)) {
    const prefix = `/${endpoint.path.split("/").filter(Boolean)[0]}`;
    assert.ok(API_PROXY_PREFIXES.includes(prefix), `missing proxy prefix ${prefix}`);
  }
});
