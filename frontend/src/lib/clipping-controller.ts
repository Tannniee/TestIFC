import * as THREE from "three";
import { sectionBoxPlanes, validSectionBox } from "./viewer-clipping";
import type { ClippingSessionState } from "./workspace-contracts";

export class ClippingController {
  private state: ClippingSessionState = { kind: "none" };
  constructor(private readonly renderer: THREE.WebGLRenderer) {}
  capture(): ClippingSessionState { return structuredClone(this.state); }
  apply(state: ClippingSessionState, modelSize = 1) {
    let planes: THREE.Plane[] = [];
    if (state.kind === "sectionBox") {
      if (!validSectionBox(state.box)) throw new Error("Invalid Section Box");
      planes = sectionBoxPlanes(state.box);
    } else if (state.kind === "sectionPlane") {
      const { point, normal, side } = state.definition;
      const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
      const p = new THREE.Vector3(point.x, point.y, point.z);
      if (![...p.toArray(), ...n.toArray()].every(Number.isFinite) || n.lengthSq() < .5) throw new Error("Invalid Section Plane");
      p.addScaledVector(n, (side === "positive" ? -1 : 1) * THREE.MathUtils.clamp(modelSize * .00001, .0001, .02));
      planes = [new THREE.Plane().setFromNormalAndCoplanarPoint(side === "positive" ? n : n.negate(), p)];
    }
    this.state = structuredClone(state);
    this.renderer.clippingPlanes = planes;
  }
  overlay(render: () => void) {
    const planes = this.renderer.clippingPlanes;
    this.renderer.clippingPlanes = [];
    try { render(); } finally { this.renderer.clippingPlanes = planes; }
  }
}
