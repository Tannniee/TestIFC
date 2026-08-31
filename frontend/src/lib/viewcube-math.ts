import * as THREE from "three";
import type { CameraOrientation, ViewDirection } from "./viewer-contracts";

export type Vec3 = readonly [number, number, number];
export type ViewCubeSurfaceKind = "face" | "edge" | "corner";
export type ViewCubeAxis = "x" | "y" | "z";

export interface ViewCubeText {
  viewCube: string;
  directions: string;
  quickViews: string;
  viewFrom: string;
  edge: string;
  corner: string;
  left: string;
  right: string;
  back: string;
  front: string;
  top: string;
  bottom: string;
  homeIso: string;
}

export interface ViewCubeSurface {
  key: string;
  kind: ViewCubeSurfaceKind;
  direction: ViewDirection;
  label: string;
  width: number;
  height: number;
  transform: string;
  axis?: ViewCubeAxis;
  originY?: number;
  clipPath?: string;
  basisU?: Vec3;
  basisV?: Vec3;
}

export interface ViewCubeQuickView {
  className: string;
  direction: ViewDirection;
  highlight: string;
}

const SIZE = 96;
const HALF = SIZE / 2;
const BEVEL = 14;
const FACE_SIZE = SIZE - BEVEL * 2;
const EDGE_DEPTH = BEVEL * Math.SQRT2;
const CORNER_SIDE = BEVEL * Math.SQRT2;
const CORNER_HEIGHT = CORNER_SIDE * Math.sqrt(3) / 2;
const ISO_DIRECTION = new THREE.Vector3(8, 6, 8).normalize();

export const VIEW_CUBE_DRAG_THRESHOLD = 6;
export const VIEW_CUBE_ORBIT_RADIANS_PER_PIXEL = Math.PI / 260;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const multiply = (a: Vec3, value: number): Vec3 => [a[0] * value, a[1] * value, a[2] * value];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vectorLength = (value: Vec3) => Math.hypot(value[0], value[1], value[2]);

function normalize(value: Vec3): Vec3 {
  const length = vectorLength(value);
  return length === 0 ? [0, 0, 0] : [value[0] / length, value[1] / length, value[2] / length];
}

// CSS uses Y-up; viewer navigation uses engineering Z-up.
export const engineeringToCube = (value: Vec3): Vec3 => [value[0], value[2], -value[1]];
const worldToCss = (value: Vec3): Vec3 => [value[0], -value[1], value[2]];

function formatNumber(value: number) {
  if (Math.abs(value) < 0.000001) return "0";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function makeSurfaceBasis(normalWorld: Vec3, preferredUWorld: Vec3) {
  const normal = normalize(worldToCss(normalWorld));
  let preferredU = worldToCss(preferredUWorld);
  preferredU = subtract(preferredU, multiply(normal, dot(preferredU, normal)));
  let u = normalize(preferredU);
  if (vectorLength(u) < 0.001) {
    const fallback: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    u = normalize(subtract(fallback, multiply(normal, dot(fallback, normal))));
  }
  const v = normalize(cross(normal, u));
  return { u, v, normal };
}

function makeSurfaceMatrix(centerWorld: Vec3, normalWorld: Vec3, preferredUWorld: Vec3) {
  const center = worldToCss(centerWorld);
  const { u, v, normal } = makeSurfaceBasis(normalWorld, preferredUWorld);
  return `matrix3d(${[
    u[0], u[1], u[2], 0,
    v[0], v[1], v[2], 0,
    normal[0], normal[1], normal[2], 0,
    center[0], center[1], center[2], 1,
  ].map(formatNumber).join(",")})`;
}

export const directionKey = (direction: ViewDirection) => `${direction.x}:${direction.y}:${direction.z}`;

function axisDirectionLabel(direction: ViewDirection) {
  const result: string[] = [];
  if (direction.x === 1) result.push("+X");
  if (direction.x === -1) result.push("−X");
  if (direction.y === 1) result.push("+Y");
  if (direction.y === -1) result.push("−Y");
  if (direction.z === 1) result.push("+Z");
  if (direction.z === -1) result.push("−Z");
  return result.join(" / ");
}

export function viewNames(direction: ViewDirection, text: ViewCubeText) {
  const result: string[] = [];
  if (direction.z === 1) result.push(text.top);
  if (direction.z === -1) result.push(text.bottom);
  if (direction.y === -1) result.push(text.front);
  if (direction.y === 1) result.push(text.back);
  if (direction.x === -1) result.push(text.left);
  if (direction.x === 1) result.push(text.right);
  return result;
}

export function surfaceName(surface: ViewCubeSurface, text: ViewCubeText) {
  const names = viewNames(surface.direction, text).join(" / ");
  if (surface.kind === "face") return names;
  return `${surface.kind === "edge" ? text.edge : text.corner}: ${names}`;
}

function makeFace(direction: ViewDirection, axis: ViewCubeAxis, preferredU: Vec3, label: string): ViewCubeSurface {
  const normal = engineeringToCube([direction.x, direction.y, direction.z]);
  const preferredCubeU = engineeringToCube(preferredU);
  const { u, v } = makeSurfaceBasis(normal, preferredCubeU);
  return {
    key: directionKey(direction), kind: "face", direction, label, axis,
    width: FACE_SIZE, height: FACE_SIZE,
    transform: makeSurfaceMatrix(multiply(normal, HALF), normal, preferredCubeU),
    basisU: u, basisV: v,
  };
}

const faces: ViewCubeSurface[] = [
  makeFace({ x: 1, y: 0, z: 0 }, "x", [0, 0, -1], "RIGHT"),
  makeFace({ x: -1, y: 0, z: 0 }, "x", [0, 0, 1], "LEFT"),
  makeFace({ x: 0, y: 1, z: 0 }, "y", [1, 0, 0], "BACK"),
  makeFace({ x: 0, y: -1, z: 0 }, "y", [1, 0, 0], "FRONT"),
  makeFace({ x: 0, y: 0, z: 1 }, "z", [1, 0, 0], "TOP"),
  makeFace({ x: 0, y: 0, z: -1 }, "z", [-1, 0, 0], "BOTTOM"),
];

function makeEdge(direction: ViewDirection): ViewCubeSurface {
  const cubeDirection = engineeringToCube([direction.x, direction.y, direction.z]);
  const normal = normalize(cubeDirection);
  const coordinate = HALF - BEVEL / 2;
  const center: Vec3 = [
    cubeDirection[0] === 0 ? 0 : cubeDirection[0] * coordinate,
    cubeDirection[1] === 0 ? 0 : cubeDirection[1] * coordinate,
    cubeDirection[2] === 0 ? 0 : cubeDirection[2] * coordinate,
  ];
  const preferredEngineering: Vec3 = direction.x === 0 ? [1, 0, 0] : direction.y === 0 ? [0, 1, 0] : [0, 0, 1];
  return {
    key: directionKey(direction), kind: "edge", direction,
    label: axisDirectionLabel(direction), width: FACE_SIZE, height: EDGE_DEPTH,
    transform: makeSurfaceMatrix(center, normal, engineeringToCube(preferredEngineering)),
  };
}

const edges: ViewCubeSurface[] = [];
for (const x of [-1, 1] as const) for (const y of [-1, 1] as const) edges.push(makeEdge({ x, y, z: 0 }));
for (const x of [-1, 1] as const) for (const z of [-1, 1] as const) edges.push(makeEdge({ x, y: 0, z }));
for (const y of [-1, 1] as const) for (const z of [-1, 1] as const) edges.push(makeEdge({ x: 0, y, z }));

function makeCorner(direction: ViewDirection): ViewCubeSurface {
  const [sx, sy, sz] = engineeringToCube([direction.x, direction.y, direction.z]);
  const a: Vec3 = [sx * HALF, sy * (HALF - BEVEL), sz * (HALF - BEVEL)];
  const b: Vec3 = [sx * (HALF - BEVEL), sy * HALF, sz * (HALF - BEVEL)];
  const c: Vec3 = [sx * (HALF - BEVEL), sy * (HALF - BEVEL), sz * HALF];
  const center = multiply(add(add(a, b), c), 1 / 3);
  const normal = normalize([sx, sy, sz]);
  const preferredU = normalize(subtract(b, a));
  const { v } = makeSurfaceBasis(normal, preferredU);
  const apexIsTop = dot(subtract(worldToCss(c), worldToCss(center)), v) < 0;
  return {
    key: directionKey(direction), kind: "corner", direction,
    label: axisDirectionLabel(direction), width: CORNER_SIDE, height: CORNER_HEIGHT,
    originY: apexIsTop ? 2 / 3 : 1 / 3,
    clipPath: apexIsTop ? "polygon(50% 0, 100% 100%, 0 100%)" : "polygon(0 0, 100% 0, 50% 100%)",
    transform: makeSurfaceMatrix(center, normal, preferredU),
  };
}

const corners: ViewCubeSurface[] = [];
for (const x of [-1, 1] as const) for (const y of [-1, 1] as const) {
  for (const z of [-1, 1] as const) corners.push(makeCorner({ x, y, z }));
}

export const VIEW_CUBE_SURFACES = [...faces, ...edges, ...corners];

export const VIEW_CUBE_QUICK_VIEWS: ViewCubeQuickView[] = [
  { className: "left-view", direction: { x: -1, y: 0, z: 0 }, highlight: "4.5,8 9,4 9,15.5 4.5,20" },
  { className: "right-view", direction: { x: 1, y: 0, z: 0 }, highlight: "15,8 19.5,4 19.5,15.5 15,20" },
  { className: "top-view", direction: { x: 0, y: 0, z: 1 }, highlight: "4.5,8 9,4 19.5,4 15,8" },
  { className: "bottom-view", direction: { x: 0, y: 0, z: -1 }, highlight: "4.5,20 9,15.5 19.5,15.5 15,20" },
  { className: "front-view", direction: { x: 0, y: -1, z: 0 }, highlight: "4.5,8 15,8 15,20 4.5,20" },
  { className: "back-view", direction: { x: 0, y: 1, z: 0 }, highlight: "9,4 19.5,4 19.5,15.5 9,15.5" },
];

function cssRotationMatrix(value: CameraOrientation) {
  const inverseCamera = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(value.x, value.y, value.z, value.w).normalize().invert(),
  );
  const flipY = new THREE.Matrix4().makeScale(1, -1, 1);
  return flipY.clone().multiply(inverseCamera).multiply(flipY);
}

export function orientationTransform(value: CameraOrientation) {
  return `matrix3d(${cssRotationMatrix(value).elements.map(formatNumber).join(",")})`;
}

export function faceLabelTransform(surface: ViewCubeSurface, value: CameraOrientation) {
  if (!surface.basisU || !surface.basisV) return undefined;
  const rotation = new THREE.Matrix3().setFromMatrix4(cssRotationMatrix(value));
  const ru = new THREE.Vector3(...surface.basisU).applyMatrix3(rotation);
  const rv = new THREE.Vector3(...surface.basisV).applyMatrix3(rotation);
  let angle = Math.atan2(-ru.y, rv.y);
  const projectedX = ru.x * Math.cos(angle) + rv.x * Math.sin(angle);
  if (projectedX < 0) angle += Math.PI;
  return `rotate(${angle}rad)`;
}

export function currentDirectionKey(value: CameraOrientation) {
  const cameraDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion(value.x, value.y, value.z, value.w).normalize(),
  );
  const engineeringDirection: Vec3 = [cameraDirection.x, -cameraDirection.z, cameraDirection.y];
  let closest: ViewCubeSurface | null = null;
  let closestDot = -1;
  for (const surface of VIEW_CUBE_SURFACES) {
    const direction = normalize([surface.direction.x, surface.direction.y, surface.direction.z]);
    const similarity = dot(engineeringDirection, direction);
    if (similarity > closestDot) {
      closest = surface;
      closestDot = similarity;
    }
  }
  return closestDot >= 0.985 ? closest?.key ?? null : null;
}

export function isIsoOrientation(value: CameraOrientation) {
  const cameraDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion(value.x, value.y, value.z, value.w).normalize(),
  );
  return cameraDirection.dot(ISO_DIRECTION) > 0.9995;
}

export const surfaceClass = (surface: ViewCubeSurface) => `view-cube__surface view-cube__surface--${surface.kind}`;

export function surfaceStyle(surface: ViewCubeSurface) {
  const originY = surface.originY ?? 0.5;
  return [
    `width:${surface.width}px`, `height:${surface.height}px`,
    `margin-left:${-surface.width / 2}px`, `margin-top:${-surface.height * originY}px`,
    `transform-origin:50% ${originY * 100}%`, `transform:${surface.transform}`,
    surface.clipPath ? `clip-path:${surface.clipPath}` : "",
  ].filter(Boolean).join(";");
}
