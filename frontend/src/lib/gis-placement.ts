import * as THREE from "three";
import type { ManualAnchor } from "./api-contracts";
import type { ModelGeoreferenceResponse } from "./api-contracts";
import type { GisModelBounds } from "./gis-footprint";

/** Viewer coordinates are X east, Y up and -Z north. The anchor marks the
 * horizontal bounds center; elevation marks the bottom of the bounds. */
export function modelMercatorMatrix(anchor: ManualAnchor, bounds: GisModelBounds,
  origin: { x: number; y: number; z: number; meterScale: number }): THREE.Matrix4 {
  const centerEast = (bounds.minEast + bounds.maxEast) / 2;
  const centerViewerZ = -(bounds.minNorth + bounds.maxNorth) / 2;
  const theta = anchor.rotationDegrees * Math.PI / 180;
  const meters = origin.meterScale * anchor.scale;
  return new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z)
    .multiply(new THREE.Matrix4().makeScale(meters, -meters, meters))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeRotationY(-theta))
    .multiply(new THREE.Matrix4().makeTranslation(-centerEast, -bounds.minHeight - (anchor.groundOffsetMeters ?? 0), -centerViewerZ));
}

export type GisControlPoints = NonNullable<ModelGeoreferenceResponse["wgs84"]>["controlPoints"];

/** One-metre IFC engineering basis transformed through the declared CRS.
 * `coordination` is the Fragments shift from original viewer space to current
 * viewer space; its inverse prevents applying COORDINATE_TO_ORIGIN twice. */
export function georeferencedMercatorMatrix(
  mercator: Record<keyof GisControlPoints, { x: number; y: number; z: number }>,
  coordination: THREE.Matrix4,
): THREE.Matrix4 {
  const { origin, east, north, up } = mercator;
  const x = new THREE.Vector3(east.x - origin.x, east.y - origin.y, east.z - origin.z);
  const y = new THREE.Vector3(up.x - origin.x, up.y - origin.y, up.z - origin.z);
  const z = new THREE.Vector3(origin.x - north.x, origin.y - north.y, origin.z - north.z);
  const map = new THREE.Matrix4().makeBasis(x, y, z);
  map.setPosition(origin.x, origin.y, origin.z);
  return map.multiply(coordination.clone().invert());
}
