import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  VIEW_CUBE_SURFACES,
  currentDirectionKey,
  directionKey,
  engineeringToCube,
  orientationTransform,
  viewNames,
} from "../src/lib/viewcube-math.ts";

const text = {
  top: "Top",
  bottom: "Bottom",
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
};

function cameraOrientation(position, up = new THREE.Vector3(0, 1, 0)) {
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, new THREE.Vector3(), up),
  );
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

test("ViewCube exposes six faces, twelve edges, and eight corners", () => {
  const kinds = Object.groupBy(VIEW_CUBE_SURFACES, (surface) => surface.kind);
  assert.equal(kinds.face.length, 6);
  assert.equal(kinds.edge.length, 12);
  assert.equal(kinds.corner.length, 8);
  assert.equal(new Set(VIEW_CUBE_SURFACES.map((surface) => surface.key)).size, 26);
});

test("engineering Z-up maps to CSS cube Y-up", () => {
  assert.deepEqual(engineeringToCube([1, 2, 3]), [1, 3, -2]);
  assert.deepEqual(viewNames({ x: -1, y: -1, z: 1 }, text), ["Top", "Front", "Left"]);
});

test("camera quaternions resolve to engineering face directions", () => {
  assert.equal(currentDirectionKey(cameraOrientation(new THREE.Vector3(10, 0, 0))), directionKey({ x: 1, y: 0, z: 0 }));
  assert.equal(currentDirectionKey(cameraOrientation(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 0, -1))), directionKey({ x: 0, y: 0, z: 1 }));
  assert.equal(currentDirectionKey(cameraOrientation(new THREE.Vector3(0, 0, 10))), directionKey({ x: 0, y: -1, z: 0 }));
});

test("orientation transform always emits a finite CSS matrix", () => {
  const value = orientationTransform(cameraOrientation(new THREE.Vector3(8, 6, 8)));
  assert.match(value, /^matrix3d\(.+\)$/);
  assert.doesNotMatch(value, /NaN|Infinity/);
});
