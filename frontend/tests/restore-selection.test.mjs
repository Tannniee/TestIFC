import assert from "node:assert/strict";
import test from "node:test";
import { resolveViewSelection } from "../src/lib/restore-selection.ts";

const ref = (localId, globalId = null, artifactId = "old", modelHash = "ifc") => ({ localId, globalId, artifactId, modelHash });
test("exact artifact preserves duplicate and missing GUID selections without querying all identities", async () => {
  const model = { getGuids() { throw new Error("unexpected full model query"); } };
  assert.deepEqual(await resolveViewSelection(model, [ref(1,"duplicate"),ref(2,"duplicate"),ref(3),ref(1),ref(5,null,"old","other")],"ifc","old",()=>{}),[1,2,3]);
});
test("changed artifact restores only unique GUIDs; no guessed local IDs", async () => {
  const model = { async getGuids() { return ["duplicate","unique","duplicate"]; },
    async getLocalIdsByGuids(guids) { assert.deepEqual(guids,["unique"]); return [99]; } };
  assert.deepEqual(await resolveViewSelection(model,[ref(1,"duplicate"),ref(2,"unique"),ref(3),ref(4,"missing"),ref(5,null,"new")],"ifc","new",()=>{}),[5,99]);
});
test("an obsolete restore stops before resolving or publishing selection", async () => {
  const model = { async getGuids() { return ["unique"]; }, getLocalIdsByGuids() { throw new Error("obsolete query"); } };
  await assert.rejects(resolveViewSelection(model,[ref(1,"unique")],"ifc","new",()=>{throw new Error("cancelled");}), /cancelled/);
});
