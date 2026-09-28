import assert from "node:assert/strict";
import test from "node:test";
import { bimPropertyGroups } from "../src/lib/bim-properties.ts";

test("BIM property groups keep Psets and Qto separate and preserve zero and false", () => {
  const groups = bimPropertyGroups({
    properties: { Pset_BeamCommon: { id: 10, FireRating: "2h", IsExternal: false } },
    quantities: { Qto_BeamBaseQuantities: { id: 11, NetVolume: 0, GrossArea: 12.5 } },
    units: { volumeUnit: "m3", areaUnit: "m2" },
  }, "properties");
  assert.deepEqual(groups.map(group => group.name), ["Pset_BeamCommon", "Qto_BeamBaseQuantities", "Quantity units"]);
  assert.deepEqual(groups[0].rows, [
    { name: "FireRating", value: "2h" },
    { name: "IsExternal", value: "false" },
  ]);
  assert.deepEqual(groups[1].rows, [
    { name: "NetVolume", value: "0" },
    { name: "GrossArea", value: "12.5" },
  ]);
});

test("BIM relationship groups expose type, material, and every classification", () => {
  const groups = bimPropertyGroups({
    type: { ifcType: "IfcBeamType", name: "HEA 200", expressId: 8 },
    material: { ifcType: "IfcMaterial", name: "S355", expressId: 9 },
    classifications: [
      { identification: "A", name: "Steel" },
      { identification: "B", name: "Frame" },
    ],
  }, "relations");
  assert.deepEqual(groups.map(group => group.name), ["Type", "Material", "Classification 1", "Classification 2"]);
  assert.deepEqual(groups[2].rows, [{ name: "identification", value: "A" }, { name: "name", value: "Steel" }]);
});
