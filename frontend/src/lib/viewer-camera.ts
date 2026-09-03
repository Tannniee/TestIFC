import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CameraSessionState } from "./workspace-contracts";
import type { CameraOrientation, SectionPlaneDefinition, ViewerTool, ViewDirection, ViewPreset } from "./viewer-contracts";

const FIT_PADDING = 1.08;
const FIT_ANIMATION_DURATION_MS = 420;
const FIT_ZOOM_OUT_DURATION_PER_OCTAVE_MS = 115;
const FIT_ZOOM_OUT_MAX_EXTRA_DURATION_MS = 680;
const BOX_ZOOM_PADDING = 1.05;
const BOX_ZOOM_ANIMATION_DURATION_MS = 400;
const CAMERA_ROTATION_DURATION_MS = 120;

export interface FitCameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  effectiveHeight: number;
  zoom: number;
  near: number;
  far: number;
}

interface FitAnimation {
  id: number;
  kind: "fit" | "view" | "boxZoom";
  startedAt: number;
  durationMs: number;
  from: FitCameraState;
  to: FitCameraState;
  fromRotation: THREE.Quaternion;
  toRotation: THREE.Quaternion;
  fromDistance: number;
  toDistance: number;
}

export interface ViewerCameraCallbacks {
  onOrientationChange(orientation: CameraOrientation): void;
  onUpdate(force: boolean, context?: CameraUpdateContext): void;
}

export interface CameraUpdateContext {
  revision: number;
  transitionId: number | null;
  kind: "fit" | "view" | "boxZoom" | "controls";
  progress: number;
  heightRatioToTarget: number;
}

export class ViewerCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1_000_000);
  private readonly controls: OrbitControls;
  private orthographicHeight = 24;
  private animation: FitAnimation | null = null;
  private transitionSequence = 0;
  private cameraRevision = 0;
  private applyingState = false;
  private animationWaiters: Array<(completed: boolean) => void> = [];

  constructor(
    private readonly host: HTMLElement,
    canvas: HTMLCanvasElement,
    private readonly callbacks: ViewerCameraCallbacks,
  ) {
    this.camera.position.set(14, 12, 14);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.controls.addEventListener("start", this.onControlsStart);
    this.controls.addEventListener("change", this.onControlsChanged);
    this.emitOrientation();
  }

  get zoomSpeed() {
    return this.controls.zoomSpeed;
  }

  setZoomSpeed(speed: number) {
    this.controls.zoomSpeed = THREE.MathUtils.clamp(speed, 0.25, 3);
  }

  get rotationSpeed() { return this.controls.rotateSpeed; }

  setRotationSpeed(speed: number) {
    if (Number.isFinite(speed)) this.controls.rotateSpeed = THREE.MathUtils.clamp(speed, 0.25, 3);
  }

  centerOrbit(target: THREE.Vector3) {
    if (!target.toArray().every(Number.isFinite)) return;
    const current = this.currentState();
    const offset = target.clone().sub(current.target);
    // Pan gently to the new pivot without changing scale or viewing direction.
    this.startAnimation({ ...current, target: target.clone(), position: current.position.add(offset) }, 340);
  }

  setEnabled(enabled: boolean) {
    this.controls.enabled = enabled;
  }

  setTool(tool: ViewerTool) {
    this.controls.enabled = true;
    this.controls.zoomToCursor = tool !== "selectOrbit";
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = tool === "multiSelect" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  }

  cancelAnimation() {
    this.animation = null;
    this.finishWaiters(false);
  }

  private finishWaiters(completed: boolean) { for (const resolve of this.animationWaiters.splice(0)) resolve(completed); }
  settled(): Promise<boolean> { return this.animation ? new Promise(resolve => this.animationWaiters.push(resolve)) : Promise.resolve(true); }
  captureSession(): CameraSessionState {
    const state = this.currentState();
    return { ...state, position: { ...state.position }, target: { ...state.target }, up: { ...state.up } };
  }
  restoreSession(state: CameraSessionState) {
    this.restoreState({ ...state, position: new THREE.Vector3(state.position.x,state.position.y,state.position.z),
      target: new THREE.Vector3(state.target.x,state.target.y,state.target.z), up: new THREE.Vector3(state.up.x,state.up.y,state.up.z) });
  }
  fitFromOrientation(box: THREE.Box3, source: CameraSessionState) {
    const direction = new THREE.Vector3(source.position.x-source.target.x, source.position.y-source.target.y, source.position.z-source.target.z).normalize();
    const up = new THREE.Vector3(source.up.x, source.up.y, source.up.z);
    const target = Math.abs(direction.y) > .999 ? this.createFitState(box, this.viewPresetVectors("iso").direction, new THREE.Vector3(0,1,0))
      : this.createFitState(box, direction, up);
    this.startAnimation(target, FIT_ANIMATION_DURATION_MS, true, "fit");
  }

  captureState(): FitCameraState { return this.currentState(); }
  restoreState(state: FitCameraState) {
    this.cancelAnimation();
    this.applyState(state);
    this.callbacks.onUpdate(true);
  }

  resize(width: number, height: number) {
    this.updateProjection(width, height);
  }

  render(time: number) {
    this.advanceAnimation(time);
    const changed = this.controls.update();
    return changed || this.animation !== null;
  }

  fit(box: THREE.Box3, animate = true) {
    if (box.isEmpty()) return;
    const target = this.createFitState(box);
    this.cancelAnimation();
    if (animate) this.startAnimation(target, FIT_ANIMATION_DURATION_MS, true, "fit");
    else {
      this.applyState(target);
      this.callbacks.onUpdate(true);
    }
  }

  setView(box: THREE.Box3, preset: ViewPreset, animate = true) {
    if (box.isEmpty()) return;
    const { direction, up } = this.viewPresetVectors(preset);
    const state = this.createFitState(box, direction, up);
    if (animate) this.startAnimation(state, FIT_ANIMATION_DURATION_MS, true);
    else this.restoreState(state);
  }

  setViewDirection(box: THREE.Box3, value: ViewDirection) {
    if (box.isEmpty()) return;
    const direction = new THREE.Vector3(value.x, value.z, -value.y);
    if (direction.lengthSq() < Number.EPSILON) return;
    direction.normalize();
    const up = Math.abs(direction.y) > 0.95
      ? new THREE.Vector3(0, 0, direction.y > 0 ? -1 : 1)
      : new THREE.Vector3(0, 1, 0);
    this.startAnimation(this.createFitState(box, direction, up), FIT_ANIMATION_DURATION_MS, true);
  }

  orbit(deltaAzimuth: number, deltaPolar: number) {
    if (!Number.isFinite(deltaAzimuth) || !Number.isFinite(deltaPolar)) return;
    this.cancelAnimation();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaAzimuth * this.rotationSpeed;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + deltaPolar * this.rotationSpeed, 0.01, Math.PI - 0.01);
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.callbacks.onUpdate(false);
  }

  viewSection(box: THREE.Box3, section: SectionPlaneDefinition) {
    if (box.isEmpty()) return;
    const direction = new THREE.Vector3(section.normal.x, section.normal.y, section.normal.z)
      .multiplyScalar(section.side === "positive" ? 1 : -1)
      .normalize();
    const up = Math.abs(direction.dot(new THREE.Vector3(0, 1, 0))) > 0.95
      ? new THREE.Vector3(0, 0, -1)
      : new THREE.Vector3(0, 1, 0);
    this.startAnimation(this.createFitState(box, direction, up), FIT_ANIMATION_DURATION_MS, true);
  }

  zoomToViewportBox(left: number, top: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
    const current = this.currentState();
    const viewWidth = current.effectiveHeight * (viewportWidth / viewportHeight);
    const centerX = left + width * 0.5;
    const centerY = top + height * 0.5;
    const ndcX = (centerX / viewportWidth) * 2 - 1;
    const ndcY = 1 - (centerY / viewportHeight) * 2;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const offset = right.multiplyScalar(ndcX * viewWidth * 0.5)
      .add(up.multiplyScalar(ndcY * current.effectiveHeight * 0.5));
    const scale = Math.max(width / viewportWidth, height / viewportHeight);
    this.startAnimation({
      position: current.position.clone().add(offset),
      target: current.target.clone().add(offset),
      up: current.up.clone(),
      effectiveHeight: Math.max(current.effectiveHeight * scale * BOX_ZOOM_PADDING, Number.EPSILON),
      zoom: 1,
      near: current.near,
      far: current.far,
    }, BOX_ZOOM_ANIMATION_DURATION_MS, false, "boxZoom");
  }

  dispose() {
    this.cancelAnimation();
    this.controls.removeEventListener("start", this.onControlsStart);
    this.controls.removeEventListener("change", this.onControlsChanged);
    this.controls.dispose();
  }

  private updateProjection(width: number, height: number) {
    const halfHeight = this.orthographicHeight * 0.5;
    const halfWidth = halfHeight * (width / height);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  private createFitState(
    box: THREE.Box3,
    direction = new THREE.Vector3(8, 6, 8).normalize(),
    up = new THREE.Vector3(0, 1, 0),
  ): FitCameraState {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 1);
    const normalizedDirection = direction.clone().normalize();
    const normalizedUp = up.clone().normalize();
    const position = center.clone().addScaledVector(normalizedDirection, radius * 2.5);
    const viewDirection = center.clone().sub(position).normalize();
    const right = viewDirection.clone().cross(normalizedUp).normalize();
    const viewUp = right.clone().cross(viewDirection).normalize();
    let halfProjectedWidth = 0;
    let halfProjectedHeight = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const offset = new THREE.Vector3(x, y, z).sub(center);
          halfProjectedWidth = Math.max(halfProjectedWidth, Math.abs(offset.dot(right)));
          halfProjectedHeight = Math.max(halfProjectedHeight, Math.abs(offset.dot(viewUp)));
        }
      }
    }
    const aspect = Math.max(this.host.clientWidth, 1) / Math.max(this.host.clientHeight, 1);
    return {
      position,
      target: center,
      up: normalizedUp,
      effectiveHeight: Math.max(halfProjectedHeight * 2, (halfProjectedWidth * 2) / aspect, 1) * FIT_PADDING,
      zoom: 1,
      near: Math.max(radius / 10_000, 0.01),
      far: Math.max(radius * 20, 10_000),
    };
  }

  private applyState(state: FitCameraState) {
    this.camera.position.copy(state.position);
    this.controls.target.copy(state.target);
    this.camera.up.copy(state.up);
    this.camera.zoom = state.zoom;
    this.camera.near = state.near;
    this.camera.far = state.far;
    this.orthographicHeight = state.effectiveHeight * state.zoom;
    this.updateProjection(Math.max(this.host.clientWidth, 1), Math.max(this.host.clientHeight, 1));
    this.applyingState = true;
    try { this.controls.update(); } finally { this.applyingState = false; }
  }

  private currentState(): FitCameraState {
    const zoom = Math.max(this.camera.zoom, Number.EPSILON);
    return {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      up: this.camera.up.clone(),
      effectiveHeight: this.orthographicHeight / zoom,
      zoom,
      near: this.camera.near,
      far: this.camera.far,
    };
  }

  private startAnimation(target: FitCameraState, durationMs: number, adaptToZoomOut = false, kind: FitAnimation["kind"] = "view") {
    this.cancelAnimation();
    const current = this.currentState();
    const fromRotation = this.rotationForState(current);
    const toRotation = this.rotationForState(target);
    const rotationRatio = fromRotation.angleTo(toRotation) / Math.PI;
    const zoomOutRatio = target.effectiveHeight / Math.max(current.effectiveHeight, Number.EPSILON);
    const zoomOutOctaves = adaptToZoomOut ? Math.max(0, Math.log2(zoomOutRatio)) : 0;
    const extraDuration = THREE.MathUtils.clamp(zoomOutOctaves * FIT_ZOOM_OUT_DURATION_PER_OCTAVE_MS, 0, FIT_ZOOM_OUT_MAX_EXTRA_DURATION_MS);
    this.camera.near = Math.min(current.near, target.near);
    this.camera.far = Math.max(current.far, target.far);
    this.camera.updateProjectionMatrix();
    this.animation = {
      id: ++this.transitionSequence,
      kind,
      startedAt: performance.now(),
      durationMs: durationMs + extraDuration + rotationRatio * CAMERA_ROTATION_DURATION_MS,
      from: current,
      to: target,
      fromRotation,
      toRotation,
      fromDistance: current.position.distanceTo(current.target),
      toDistance: target.position.distanceTo(target.target),
    };
    this.notifyUpdate(false, this.animation, 0);
  }

  private rotationForState(state: FitCameraState) {
    const matrix = new THREE.Matrix4().lookAt(state.position, state.target, state.up);
    return new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
  }

  private advanceAnimation(now: number) {
    const animation = this.animation;
    if (!animation) return;
    const progress = THREE.MathUtils.clamp((now - animation.startedAt) / animation.durationMs, 0, 1);
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    const effectiveHeight = THREE.MathUtils.lerp(animation.from.effectiveHeight, animation.to.effectiveHeight, eased);
    const zoom = THREE.MathUtils.lerp(animation.from.zoom, animation.to.zoom, eased);
    this.controls.target.lerpVectors(animation.from.target, animation.to.target, eased);
    const rotation = animation.fromRotation.clone().slerp(animation.toRotation, eased);
    const distance = THREE.MathUtils.lerp(animation.fromDistance, animation.toDistance, eased);
    this.camera.up.set(0, 1, 0).applyQuaternion(rotation).normalize();
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).multiplyScalar(distance));
    this.camera.zoom = zoom;
    this.orthographicHeight = effectiveHeight * zoom;
    this.updateProjection(Math.max(this.host.clientWidth, 1), Math.max(this.host.clientHeight, 1));
    if (progress >= 1) {
      this.animation = null;
      this.applyState(animation.to);
      this.notifyUpdate(true, animation, 1);
      this.finishWaiters(true);
    } else {
      // Projection-only zooms do not emit OrbitControls.change.
      this.notifyUpdate(false, animation, progress);
    }
  }

  private viewPresetVectors(preset: ViewPreset) {
    const directions: Record<ViewPreset, { direction: THREE.Vector3; up: THREE.Vector3 }> = {
      iso: { direction: new THREE.Vector3(8, 6, 8).normalize(), up: new THREE.Vector3(0, 1, 0) },
      positiveX: { direction: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
      negativeX: { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
      positiveY: { direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
      negativeY: { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
      positiveZ: { direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
      negativeZ: { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
    };
    return directions[preset];
  }

  private emitOrientation() {
    const { x, y, z, w } = this.camera.quaternion;
    this.callbacks.onOrientationChange({ x, y, z, w });
  }

  private notifyUpdate(force: boolean, animation: FitAnimation | null = null, progress = 1) {
    this.callbacks.onUpdate(force, { revision: ++this.cameraRevision, transitionId: animation?.id ?? null,
      kind: animation?.kind ?? "controls", progress,
      heightRatioToTarget: animation ? (this.orthographicHeight / this.camera.zoom) / animation.to.effectiveHeight : 1 });
  }

  private readonly onControlsChanged = () => {
    this.emitOrientation();
    if (!this.animation && !this.applyingState) this.notifyUpdate(false);
  };

  private readonly onControlsStart = () => {
    this.cancelAnimation();
  };
}
