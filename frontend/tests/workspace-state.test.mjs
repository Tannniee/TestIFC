import assert from "node:assert/strict";
import test from "node:test";
import { validateViewState, activeView, emptyWorkspace } from "../src/lib/workspace-contracts.ts";

const state = () => ({ schemaVersion: 1, coordinateSpaceVersion: "viewer-v1",
  camera: { position: { x: 10, y: 10, z: 10 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, effectiveHeight: 10, zoom: 2, near: .01, far: 1000 },
  clipping: { kind: "sectionBox", box: { enabled: true, min: { x: -1, y: -2, z: -3 }, max: { x: 1, y: 2, z: 3 } } },
  selection: [], measurements: [], boxDisplay: { showBox: true, showHandles: true } });
test("view snapshots survive JSON and reject invalid camera / crossed clipping faces", () => {
  const view = JSON.parse(JSON.stringify(state())); validateViewState(view);
  view.camera.zoom = 0; assert.throws(() => validateViewState(view), /camera/);
  view.camera.zoom = 2; view.clipping.box.max.y = -3; assert.throws(() => validateViewState(view), /Box/);
  view.clipping.box.max.y = 3; view.camera.position = { ...view.camera.target }; assert.throws(() => validateViewState(view), /camera/);
});
test("active view is derived from its document, including the empty workspace", () => {
  const workspace = emptyWorkspace(); assert.equal(activeView(workspace), null);
  const a = { id: "a", activeViewId: "av", views: [{ id: "av" }] };
  const b = { id: "b", activeViewId: "bv", views: [{ id: "bv" }] };
  workspace.documents = [a, b]; workspace.activeDocumentId = "b";
  assert.equal(activeView(workspace), b.views[0]);
});
