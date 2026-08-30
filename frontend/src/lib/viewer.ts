import { FragmentsModels, RenderedFaces, ifcCategoryMap, type FragmentsModel, type ItemData } from "@thatopen/fragments";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { api, isAuthorizationError, type SelectionElement, type SelectionPayload } from "./api";

export type ViewerStage =
  | "uploading"
  | "cache"
  | "reading"
  | "converting"
  | "loading"
  | "ready"
  | "selecting"
  | "error";

export type ViewportBackground = "gray" | "white" | "oled";
export type ViewPreset = "iso" | "positiveX" | "negativeX" | "positiveY" | "negativeY" | "positiveZ" | "negativeZ";
export type SectionSide = "positive" | "negative";
export type ViewStep = -1 | 0 | 1;

export interface ViewDirection {
  x: ViewStep;
  y: ViewStep;
  z: ViewStep;
}

export interface Vector3Value {
  x: number;
  y: number;
  z: number;
}

export interface CameraOrientation {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface SectionPlaneDefinition {
  point: Vector3Value;
  normal: Vector3Value;
  side: SectionSide;
}

const VIEWPORT_COLORS: Record<ViewportBackground, { background: number; center: number; grid: number }> = {
  gray: { background: 0x20262b, center: 0x596872, grid: 0x354149 },
  white: { background: 0xffffff, center: 0x7a8790, grid: 0xc6cdd2 },
  oled: { background: 0x000000, center: 0x53636d, grid: 0x202a30 },
};

export interface ViewerProgress {
  stage: ViewerStage;
  progress?: number;
  detail?: string;
}

export interface ViewerSelection extends SelectionElement {
  modelId: string;
  modelName: string;
  raw: ItemData | null;
}

export type BridgeStage = "activating" | "uploading" | "preparing" | "ready" | "cleared" | "error";

export interface BridgeProgress {
  stage: BridgeStage;
  progress?: number;
  detail?: string;
}

export interface ViewerCallbacks {
  onProgress(event: ViewerProgress): void;
  onBridgeProgress(event: BridgeProgress): void;
  onSelection(selection: ViewerSelection | null): void;
  onBoxZoomActiveChange(active: boolean): void;
  onSectionPickActiveChange(active: boolean): void;
  onSectionPlaneChange(section: SectionPlaneDefinition | null): void;
  onCameraOrientationChange(orientation: CameraOrientation): void;
  onAuthorizationRequired(error: unknown): void;
}

interface WorkerProgressMessage {
  type: "progress";
  id: number;
  progress: number;
}

interface WorkerDoneMessage {
  type: "done";
  id: number;
  fragments: Uint8Array;
}

interface WorkerErrorMessage {
  type: "error";
  id: number;
  message: string;
}

type WorkerMessage = WorkerProgressMessage | WorkerDoneMessage | WorkerErrorMessage;

class IfcConverter {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: {
    id: number;
    resolve(value: Uint8Array): void;
    reject(reason: unknown): void;
    onProgress(progress: number): void;
  } | null = null;

  constructor() {
    this.startWorker();
  }

  convert(bytes: ArrayBuffer, onProgress: (progress: number) => void): Promise<Uint8Array> {
    this.cancel();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject, onProgress };
      this.worker?.postMessage({ id, bytes }, [bytes]);
    });
  }

  cancel() {
    if (this.pending) {
      this.pending.reject(new LoadCancelledError());
      this.pending = null;
      this.worker?.terminate();
      this.startWorker();
    }
  }

  dispose() {
    this.pending?.reject(new LoadCancelledError());
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private startWorker() {
    this.worker = new Worker(new URL("../workers/ifc-convert.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onWorkerError);
    this.worker.addEventListener("messageerror", this.onMessageError);
  }

  private readonly onMessage = (event: MessageEvent<WorkerMessage>) => {
    const pending = this.pending;
    if (!pending || event.data.id !== pending.id) return;
    if (event.data.type === "progress") {
      pending.onProgress(event.data.progress);
      return;
    }
    this.pending = null;
    if (event.data.type === "done") pending.resolve(event.data.fragments);
    else pending.reject(new Error(event.data.message));
  };

  private readonly onWorkerError = (event: ErrorEvent) => {
    this.rejectPending(new Error(event.message || "IFC conversion worker failed"));
  };

  private readonly onMessageError = () => {
    this.rejectPending(new Error("IFC conversion worker returned unreadable data"));
  };

  private rejectPending(error: Error) {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }
}

export class LoadCancelledError extends Error {
  constructor() {
    super("Model load was replaced by a newer request");
    this.name = "LoadCancelledError";
  }
}

export function isLoadCancelledError(error: unknown): boolean {
  return error instanceof LoadCancelledError;
}

function attributeValue(item: ItemData | null, name: string): unknown {
  const attribute = item?.[name];
  if (Array.isArray(attribute) || attribute == null) return null;
  if (typeof attribute === "object" && "value" in attribute) return attribute.value;
  return null;
}

function textAttribute(item: ItemData | null, ...names: string[]): string | null {
  for (const name of names) {
    const value = attributeValue(item, name);
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return null;
}

function categoryName(item: ItemData | null): string | null {
  const value = attributeValue(item, "_category");
  if (typeof value === "number") return ifcCategoryMap[value] ?? String(value);
  if (typeof value === "string") return value;
  return textAttribute(item, "type", "Type");
}

function flattenPreview(item: ItemData | null): Record<string, unknown> {
  if (!item) return {};
  const preview: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(item)) {
    if (Array.isArray(raw) || raw == null) continue;
    if (typeof raw === "object" && "value" in raw) {
      const value = raw.value;
      if (["string", "number", "boolean"].includes(typeof value)) preview[key] = value;
    } else if (["string", "number", "boolean"].includes(typeof raw)) {
      preview[key] = raw;
    }
  }
  return preview;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
const FRAGMENTS_MAX_UPDATE_RATE_MS = 16;
const FIT_PADDING = 1.08;
const FIT_ANIMATION_DURATION_MS = 420;
const FIT_ZOOM_OUT_DURATION_PER_OCTAVE_MS = 115;
const FIT_ZOOM_OUT_MAX_EXTRA_DURATION_MS = 680;
const BOX_ZOOM_PADDING = 1.05;
const BOX_ZOOM_ANIMATION_DURATION_MS = 400;
const BOX_ZOOM_MIN_SIZE_PX = 8;
const CAMERA_ROTATION_DURATION_MS = 120;
const SECTION_CLIP_EPSILON_RATIO = 0.00001;
const SECTION_CLIP_EPSILON_MIN = 0.0001;
const SECTION_CLIP_EPSILON_MAX = 0.02;

interface FitCameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  effectiveHeight: number;
  zoom: number;
  near: number;
  far: number;
}

interface FitAnimation {
  startedAt: number;
  durationMs: number;
  from: FitCameraState;
  to: FitCameraState;
  fromRotation: THREE.Quaternion;
  toRotation: THREE.Quaternion;
  fromDistance: number;
  toDistance: number;
}

export class ViewerService {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1_000_000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly boxZoomRectangle: HTMLDivElement;
  private readonly fragments = new FragmentsModels("/vendor/fragments/worker.mjs", { maxWorkers: 2 });
  private readonly converter = new IfcConverter();
  private readonly resizeObserver: ResizeObserver;
  private readonly callbacks: ViewerCallbacks;
  private readonly models = new Map<string, FragmentsModel>();
  private grid: THREE.GridHelper;
  private gridMaterials: THREE.Material[] = [];
  private viewportBackground: ViewportBackground = "gray";
  private activeModel: FragmentsModel | null = null;
  private activeModelName = "";
  private selected: { model: FragmentsModel; localId: number } | null = null;
  private orthographicHeight = 24;
  private loadSequence = 0;
  private selectionSequence = 0;
  private loadingModelId: string | null = null;
  private pointerStart: { id: number; x: number; y: number } | null = null;
  private suppressNextClick = false;
  private boxZoomEnabled = false;
  private boxZoomStart: { id: number; x: number; y: number } | null = null;
  private sectionPickEnabled = false;
  private sectionDefinition: SectionPlaneDefinition | null = null;
  private fitAnimation: FitAnimation | null = null;
  private disposed = false;

  constructor(private readonly host: HTMLElement, callbacks: ViewerCallbacks) {
    this.callbacks = callbacks;
    this.fragments.settings.maxUpdateRate = FRAGMENTS_MAX_UPDATE_RATE_MS;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(VIEWPORT_COLORS.gray.background, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-label", "IFC 3D viewport");
    this.host.append(this.renderer.domElement);
    this.boxZoomRectangle = document.createElement("div");
    this.boxZoomRectangle.className = "viewer-box-zoom-rectangle";
    this.boxZoomRectangle.hidden = true;
    this.host.append(this.boxZoomRectangle);

    this.camera.position.set(14, 12, 14);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.grid = this.createGrid("gray");
    this.scene.add(this.grid);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x33404a, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(8, 14, 10);
    this.scene.add(sun);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown, true);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove, true);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp, true);
    this.renderer.domElement.addEventListener("pointercancel", this.onPointerCancel, true);
    this.renderer.domElement.addEventListener("click", this.onClick);
    this.controls.addEventListener("start", this.onControlsStart);
    this.controls.addEventListener("change", this.onControlsChanged);
    this.renderer.setAnimationLoop(this.render);
    this.resize();
    this.emitCameraOrientation();
  }

  get hasModel() {
    return this.activeModel !== null;
  }

  get gridVisible() {
    return this.grid.visible;
  }

  get background() {
    return this.viewportBackground;
  }

  get boxZoomActive() {
    return this.boxZoomEnabled;
  }

  get wheelZoomSpeed() {
    return this.controls.zoomSpeed;
  }

  get sectionPickActive() {
    return this.sectionPickEnabled;
  }

  setGridVisible(visible: boolean) {
    this.grid.visible = visible;
  }

  setBackground(background: ViewportBackground) {
    if (background === this.viewportBackground) return;
    const elevation = this.grid.position.y;
    const visible = this.grid.visible;
    this.scene.remove(this.grid);
    this.disposeGrid(this.grid);
    this.viewportBackground = background;
    this.renderer.setClearColor(VIEWPORT_COLORS[background].background, 1);
    this.grid = this.createGrid(background);
    this.grid.position.y = elevation;
    this.grid.visible = visible;
    this.scene.add(this.grid);
  }

  setWheelZoomSpeed(speed: number) {
    this.controls.zoomSpeed = THREE.MathUtils.clamp(speed, 0.25, 3);
  }

  setBoxZoomEnabled(enabled: boolean) {
    if (enabled === this.boxZoomEnabled) return;
    if (enabled && this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.fitAnimation = null;
    this.boxZoomEnabled = enabled;
    this.controls.enabled = !enabled;
    this.pointerStart = null;
    this.resetBoxZoomDrag();
    this.host.classList.toggle("viewer-box-zoom-active", enabled);
    this.callbacks.onBoxZoomActiveChange(enabled);
  }

  setSectionPickEnabled(enabled: boolean) {
    if (enabled === this.sectionPickEnabled) return;
    if (enabled && this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    this.fitAnimation = null;
    this.sectionPickEnabled = enabled;
    this.controls.enabled = !this.boxZoomEnabled;
    this.pointerStart = null;
    this.host.classList.toggle("viewer-section-pick-active", enabled);
    this.callbacks.onSectionPickActiveChange(enabled);
  }

  setSectionPlane(definition: SectionPlaneDefinition) {
    const point = new THREE.Vector3(definition.point.x, definition.point.y, definition.point.z);
    const normal = new THREE.Vector3(definition.normal.x, definition.normal.y, definition.normal.z);
    if (!point.toArray().every(Number.isFinite) || !normal.toArray().every(Number.isFinite) || normal.lengthSq() < Number.EPSILON) return;
    normal.normalize();
    const side = definition.side;
    const clippingNormal = side === "positive" ? normal.clone() : normal.clone().negate();
    const modelSize = this.activeModel?.box.getSize(new THREE.Vector3()).length() ?? 1;
    const epsilon = THREE.MathUtils.clamp(
      modelSize * SECTION_CLIP_EPSILON_RATIO,
      SECTION_CLIP_EPSILON_MIN,
      SECTION_CLIP_EPSILON_MAX,
    );
    const clippingPoint = point.clone().addScaledVector(normal, side === "positive" ? -epsilon : epsilon);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(clippingNormal, clippingPoint);
    this.sectionDefinition = {
      point: { x: point.x, y: point.y, z: point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      side,
    };
    this.renderer.clippingPlanes = [plane];
    this.callbacks.onSectionPlaneChange(this.sectionDefinition);
    void this.fragments.update(true);
  }

  setSectionSide(side: SectionSide) {
    if (!this.sectionDefinition) return;
    this.setSectionPlane({ ...this.sectionDefinition, side });
  }

  clearSectionPlane() {
    if (!this.sectionDefinition && this.renderer.clippingPlanes.length === 0) return;
    this.sectionDefinition = null;
    this.renderer.clippingPlanes = [];
    this.callbacks.onSectionPlaneChange(null);
    void this.fragments.update(true);
  }

  setView(preset: ViewPreset) {
    const model = this.activeModel;
    if (!model || model.box.isEmpty()) return;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    const { direction, up } = this.viewPresetVectors(preset);
    const targetState = this.createFitCameraState(model.box, direction, up);
    this.startCameraAnimation(targetState, FIT_ANIMATION_DURATION_MS, true);
  }

  setViewDirection(directionValue: ViewDirection) {
    const model = this.activeModel;
    if (!model || model.box.isEmpty()) return;
    // ViewCube directions use the engineering Z-up convention. Fragments and
    // Three.js use Y-up, so rotate the cube vector -90 degrees around X before
    // applying it to the camera: (X, Y, Z) -> (X, Z, -Y).
    const direction = new THREE.Vector3(directionValue.x, directionValue.z, -directionValue.y);
    if (direction.lengthSq() < Number.EPSILON) return;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    direction.normalize();
    const up = Math.abs(direction.y) > 0.95
      ? new THREE.Vector3(0, 0, direction.y > 0 ? -1 : 1)
      : new THREE.Vector3(0, 1, 0);
    this.startCameraAnimation(this.createFitCameraState(model.box, direction, up), FIT_ANIMATION_DURATION_MS, true);
  }

  orbitView(deltaAzimuth: number, deltaPolar: number) {
    if (!this.activeModel || !Number.isFinite(deltaAzimuth) || !Number.isFinite(deltaPolar)) return;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.fitAnimation = null;

    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaAzimuth;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + deltaPolar, 0.01, Math.PI - 0.01);
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    void this.fragments.update();
  }

  viewSectionPlane() {
    const model = this.activeModel;
    const section = this.sectionDefinition;
    if (!model || model.box.isEmpty() || !section) return;
    const direction = new THREE.Vector3(section.normal.x, section.normal.y, section.normal.z)
      .multiplyScalar(section.side === "positive" ? 1 : -1)
      .normalize();
    const up = Math.abs(direction.dot(new THREE.Vector3(0, 1, 0))) > 0.95
      ? new THREE.Vector3(0, 0, -1)
      : new THREE.Vector3(0, 1, 0);
    this.startCameraAnimation(this.createFitCameraState(model.box, direction, up), FIT_ANIMATION_DURATION_MS, true);
  }

  async load(file: File): Promise<void> {
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.clearSectionPlane();
    const sequence = ++this.loadSequence;
    this.selectionSequence++;
    this.converter.cancel();
    if (this.loadingModelId) this.fragments.abort(this.loadingModelId);
    await this.clearModel();
    this.assertCurrent(sequence);
    this.publishProgress(sequence, { stage: "reading", detail: file.name });
    const ifcBuffer = await file.arrayBuffer();
    this.assertCurrent(sequence);
    const modelHash = await sha256Hex(ifcBuffer);
    this.assertCurrent(sequence);
    void this.prepareBridge(file, modelHash, sequence);
    this.publishProgress(sequence, { stage: "cache", detail: file.name });
    let fragmentBuffer: ArrayBuffer | null = null;
    try {
      fragmentBuffer = await api.getFragments(modelHash);
    } catch (error) {
      if (isAuthorizationError(error)) {
        this.callbacks.onAuthorizationRequired(error);
        throw error;
      }
      this.publishBridge(sequence, { stage: "error", detail: `Fragments cache: ${this.errorText(error)}` });
    }
    this.assertCurrent(sequence);
    if (!fragmentBuffer) {
      this.publishProgress(sequence, { stage: "converting", progress: 0, detail: file.name });
      const converted = await this.converter.convert(ifcBuffer, (progress) => {
        this.publishProgress(sequence, { stage: "converting", progress, detail: file.name });
      });
      this.assertCurrent(sequence);
      fragmentBuffer = converted.buffer.slice(converted.byteOffset, converted.byteOffset + converted.byteLength) as ArrayBuffer;
      const cacheCopy = converted.slice();
      void api.putFragments(modelHash, cacheCopy).catch((error) => {
        this.publishBridge(sequence, { stage: "error", detail: `Fragments cache: ${this.errorText(error)}` });
      });
    }

    this.publishProgress(sequence, { stage: "loading", progress: 0, detail: file.name });
    const modelId = `${modelHash}-${sequence}`;
    this.loadingModelId = modelId;
    let model: FragmentsModel;
    try {
      model = await this.fragments.load(fragmentBuffer, {
        modelId,
        camera: this.camera,
        onProgress: ({ progress }) => this.publishProgress(sequence, { stage: "loading", progress, detail: file.name }),
      });
    } catch (error) {
      if (sequence !== this.loadSequence || this.disposed) throw new LoadCancelledError();
      throw error;
    } finally {
      if (this.loadingModelId === modelId) this.loadingModelId = null;
    }
    if (sequence !== this.loadSequence || this.disposed) {
      await this.fragments.disposeModel(model.modelId);
      throw new LoadCancelledError();
    }
    this.models.set(model.modelId, model);
    this.scene.add(model.object);
    this.activeModel = model;
    this.activeModelName = file.name;
    await this.alignGridToIfcElevationZero(model);
    this.assertCurrent(sequence);
    await this.fragments.update(true);
    this.assertCurrent(sequence);
    this.fit({ animate: false });
    this.publishProgress(sequence, { stage: "ready", progress: 1, detail: this.activeModelName });
  }

  fit({ animate = true }: { animate?: boolean } = {}) {
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    const model = this.activeModel;
    if (!model || model.box.isEmpty()) return;
    const targetState = this.createFitCameraState(model.box);
    this.fitAnimation = null;

    if (!animate) {
      this.applyFitCameraState(targetState);
      void this.fragments.update(true);
      return;
    }

    this.startCameraAnimation(targetState, FIT_ANIMATION_DURATION_MS, true);
  }

  async clearSelection() {
    const selectionSequence = ++this.selectionSequence;
    if (this.selected) await this.selected.model.resetHighlight([this.selected.localId]);
    if (selectionSequence !== this.selectionSequence) return;
    this.selected = null;
    this.callbacks.onSelection(null);
    try {
      await api.clearSelection();
      if (selectionSequence === this.selectionSequence) this.callbacks.onBridgeProgress({ stage: "cleared" });
    } catch (error) {
      if (isAuthorizationError(error)) this.callbacks.onAuthorizationRequired(error);
      this.callbacks.onBridgeProgress({ stage: "error", detail: this.errorText(error) });
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.fitAnimation = null;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener("start", this.onControlsStart);
    this.controls.removeEventListener("change", this.onControlsChanged);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown, true);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove, true);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp, true);
    this.renderer.domElement.removeEventListener("pointercancel", this.onPointerCancel, true);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    this.controls.dispose();
    this.converter.dispose();
    await this.fragments.dispose();
    this.host.classList.remove("viewer-box-zoom-active");
    this.host.classList.remove("viewer-section-pick-active");
    this.boxZoomRectangle.remove();
    this.disposeGrid(this.grid);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.updateCameraProjection(width, height);
  }

  private updateCameraProjection(width: number, height: number) {
    const halfHeight = this.orthographicHeight * 0.5;
    const halfWidth = halfHeight * (width / height);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  private createFitCameraState(
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
    const effectiveHeight = Math.max(halfProjectedHeight * 2, (halfProjectedWidth * 2) / aspect, 1) * FIT_PADDING;
    return {
      position,
      target: center,
      up: normalizedUp,
      effectiveHeight,
      zoom: 1,
      near: Math.max(radius / 10_000, 0.01),
      far: Math.max(radius * 20, 10_000),
    };
  }

  private applyFitCameraState(state: FitCameraState) {
    this.camera.position.copy(state.position);
    this.controls.target.copy(state.target);
    this.camera.up.copy(state.up);
    this.camera.zoom = state.zoom;
    this.camera.near = state.near;
    this.camera.far = state.far;
    this.orthographicHeight = state.effectiveHeight * state.zoom;
    this.updateCameraProjection(Math.max(this.host.clientWidth, 1), Math.max(this.host.clientHeight, 1));
    this.controls.update();
  }

  private currentCameraState(): FitCameraState {
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

  private startCameraAnimation(targetState: FitCameraState, durationMs: number, adaptToZoomOut = false) {
    const currentState = this.currentCameraState();
    const fromRotation = this.cameraRotationForState(currentState);
    const toRotation = this.cameraRotationForState(targetState);
    const rotationRatio = fromRotation.angleTo(toRotation) / Math.PI;
    const zoomOutRatio = targetState.effectiveHeight / Math.max(currentState.effectiveHeight, Number.EPSILON);
    const zoomOutOctaves = adaptToZoomOut ? Math.max(0, Math.log2(zoomOutRatio)) : 0;
    const zoomOutExtraDuration = THREE.MathUtils.clamp(
      zoomOutOctaves * FIT_ZOOM_OUT_DURATION_PER_OCTAVE_MS,
      0,
      FIT_ZOOM_OUT_MAX_EXTRA_DURATION_MS,
    );
    this.camera.near = Math.min(currentState.near, targetState.near);
    this.camera.far = Math.max(currentState.far, targetState.far);
    this.camera.updateProjectionMatrix();
    this.fitAnimation = {
      startedAt: performance.now(),
      durationMs: durationMs + zoomOutExtraDuration + rotationRatio * CAMERA_ROTATION_DURATION_MS,
      from: currentState,
      to: targetState,
      fromRotation,
      toRotation,
      fromDistance: currentState.position.distanceTo(currentState.target),
      toDistance: targetState.position.distanceTo(targetState.target),
    };
  }

  private cameraRotationForState(state: FitCameraState) {
    const matrix = new THREE.Matrix4().lookAt(state.position, state.target, state.up);
    return new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
  }

  private advanceFitAnimation(now: number) {
    const animation = this.fitAnimation;
    if (!animation) return;
    const progress = THREE.MathUtils.clamp((now - animation.startedAt) / animation.durationMs, 0, 1);
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    const effectiveHeight = THREE.MathUtils.lerp(animation.from.effectiveHeight, animation.to.effectiveHeight, eased);
    const zoom = THREE.MathUtils.lerp(animation.from.zoom, animation.to.zoom, eased);

    this.controls.target.lerpVectors(animation.from.target, animation.to.target, eased);
    const rotation = animation.fromRotation.clone().slerp(animation.toRotation, eased);
    const distance = THREE.MathUtils.lerp(animation.fromDistance, animation.toDistance, eased);
    this.camera.up.set(0, 1, 0).applyQuaternion(rotation).normalize();
    this.camera.position.copy(this.controls.target)
      .add(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).multiplyScalar(distance));
    this.camera.zoom = zoom;
    this.orthographicHeight = effectiveHeight * zoom;
    this.updateCameraProjection(Math.max(this.host.clientWidth, 1), Math.max(this.host.clientHeight, 1));

    if (progress >= 1) {
      this.fitAnimation = null;
      this.applyFitCameraState(animation.to);
      void this.fragments.update(true);
    }
  }

  private createGrid(background: ViewportBackground): THREE.GridHelper {
    const colors = VIEWPORT_COLORS[background];
    const grid = new THREE.GridHelper(2000, 1000, colors.center, colors.grid);
    grid.position.y = -0.001;
    this.gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of this.gridMaterials) {
      material.transparent = true;
      material.opacity = 0.34;
      material.depthWrite = false;
    }
    return grid;
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

  private disposeGrid(grid: THREE.GridHelper) {
    grid.geometry.dispose();
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of materials) material.dispose();
  }

  private async alignGridToIfcElevationZero(model: FragmentsModel) {
    try {
      const coordinationMatrix = await model.getCoordinationMatrix();
      const viewerOrigin = new THREE.Vector3().applyMatrix4(coordinationMatrix);
      model.object.updateWorldMatrix(true, false);
      viewerOrigin.applyMatrix4(model.object.matrixWorld);
      if (!Number.isFinite(viewerOrigin.y)) throw new Error("Invalid IFC coordination matrix");
      this.grid.position.y = viewerOrigin.y - 0.001;
    } catch {
      this.grid.position.y = (model.box.isEmpty() ? 0 : model.box.min.y) - 0.001;
    }
  }

  private readonly render = (time: number) => {
    this.advanceFitAnimation(time);
    this.controls.update();
    const opacity = 0.34 * THREE.MathUtils.smoothstep(this.camera.zoom, 0.08, 0.65);
    for (const material of this.gridMaterials) material.opacity = opacity;
    this.renderer.render(this.scene, this.camera);
  };

  private readonly onControlsChanged = () => {
    this.emitCameraOrientation();
    void this.fragments.update();
  };

  private emitCameraOrientation() {
    const { x, y, z, w } = this.camera.quaternion;
    this.callbacks.onCameraOrientationChange({ x, y, z, w });
  }

  private readonly onControlsStart = () => {
    this.fitAnimation = null;
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.boxZoomEnabled) {
      this.startBoxZoomDrag(event);
      return;
    }
    if (event.button !== 0) return;
    this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.suppressNextClick = false;
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const start = this.boxZoomStart;
    if (!this.boxZoomEnabled || start?.id !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = this.viewportPoint(event);
    this.updateBoxZoomRectangle(start.x, start.y, point.x, point.y);
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (this.boxZoomEnabled && this.boxZoomStart?.id === event.pointerId) {
      this.finishBoxZoomDrag(event);
      return;
    }
    const start = this.pointerStart;
    if (start?.id === event.pointerId) {
      this.suppressNextClick = Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
    }
    this.pointerStart = null;
  };

  private readonly onPointerCancel = (event: PointerEvent) => {
    if (this.boxZoomStart?.id === event.pointerId) {
      this.suppressNextClick = true;
      this.setBoxZoomEnabled(false);
      return;
    }
    this.pointerStart = null;
    this.suppressNextClick = true;
  };

  private startBoxZoomDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = this.viewportPoint(event);
    this.boxZoomStart = { id: event.pointerId, x: point.x, y: point.y };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.boxZoomRectangle.hidden = false;
    this.updateBoxZoomRectangle(point.x, point.y, point.x, point.y);
  }

  private finishBoxZoomDrag(event: PointerEvent) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const start = this.boxZoomStart;
    if (!start) return;
    const end = this.viewportPoint(event);
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    this.suppressNextClick = true;
    this.setBoxZoomEnabled(false);
    if (width >= BOX_ZOOM_MIN_SIZE_PX && height >= BOX_ZOOM_MIN_SIZE_PX) {
      this.zoomToViewportBox(left, top, width, height);
    }
  }

  private viewportPoint(event: PointerEvent) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    return {
      x: THREE.MathUtils.clamp(event.clientX - bounds.left, 0, bounds.width),
      y: THREE.MathUtils.clamp(event.clientY - bounds.top, 0, bounds.height),
    };
  }

  private updateBoxZoomRectangle(startX: number, startY: number, endX: number, endY: number) {
    this.boxZoomRectangle.style.left = `${Math.min(startX, endX)}px`;
    this.boxZoomRectangle.style.top = `${Math.min(startY, endY)}px`;
    this.boxZoomRectangle.style.width = `${Math.abs(endX - startX)}px`;
    this.boxZoomRectangle.style.height = `${Math.abs(endY - startY)}px`;
  }

  private resetBoxZoomDrag() {
    const pointerId = this.boxZoomStart?.id;
    if (pointerId !== undefined && this.renderer.domElement.hasPointerCapture(pointerId)) {
      this.renderer.domElement.releasePointerCapture(pointerId);
    }
    this.boxZoomStart = null;
    this.boxZoomRectangle.hidden = true;
  }

  private zoomToViewportBox(left: number, top: number, width: number, height: number) {
    const viewportWidth = Math.max(this.renderer.domElement.clientWidth, 1);
    const viewportHeight = Math.max(this.renderer.domElement.clientHeight, 1);
    const current = this.currentCameraState();
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
    const targetState: FitCameraState = {
      position: current.position.clone().add(offset),
      target: current.target.clone().add(offset),
      up: current.up.clone(),
      effectiveHeight: Math.max(current.effectiveHeight * scale * BOX_ZOOM_PADDING, Number.EPSILON),
      zoom: 1,
      near: current.near,
      far: current.far,
    };
    this.startCameraAnimation(targetState, BOX_ZOOM_ANIMATION_DURATION_MS);
  }

  private async pickSectionPlane(clientX: number, clientY: number) {
    const model = this.activeModel;
    if (!model) return;
    const hit = await model.raycast({
      camera: this.camera,
      mouse: new THREE.Vector2(clientX, clientY),
      dom: this.renderer.domElement,
    });
    if (!hit || model !== this.activeModel || !this.sectionPickEnabled) return;
    const normal = hit.normal?.clone().normalize() ?? hit.ray?.direction.clone().negate().normalize();
    if (!normal || normal.lengthSq() < Number.EPSILON) return;
    const side = this.sectionDefinition?.side ?? "positive";
    this.setSectionPickEnabled(false);
    this.setSectionPlane({
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      side,
    });
  }

  private readonly onClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    if (this.sectionPickEnabled) {
      void this.pickSectionPlane(event.clientX, event.clientY);
      return;
    }
    void this.pick(event);
  };

  private async pick(event: MouseEvent) {
    if (!this.activeModel) return;
    const selectionSequence = ++this.selectionSequence;
    const activeModel = this.activeModel;
    this.callbacks.onProgress({ stage: "selecting" });
    // FragmentsModels converts viewport coordinates to NDC internally.
    const mouse = new THREE.Vector2(event.clientX, event.clientY);
    const hit = await activeModel.raycast({ camera: this.camera, mouse, dom: this.renderer.domElement });
    if (selectionSequence !== this.selectionSequence || activeModel !== this.activeModel) return;
    if (!hit) {
      await this.clearSelection();
      this.callbacks.onProgress({ stage: "ready", detail: this.activeModelName });
      return;
    }

    if (this.selected) await this.selected.model.resetHighlight([this.selected.localId]);
    if (selectionSequence !== this.selectionSequence) return;
    await hit.fragments.highlight([hit.localId], {
      color: new THREE.Color(0x2d8cff),
      renderedFaces: RenderedFaces.TWO,
      opacity: 1,
      transparent: false,
    });
    if (selectionSequence !== this.selectionSequence) return;
    this.selected = { model: hit.fragments, localId: hit.localId };

    const [item = null] = await hit.fragments.getItemsData([hit.localId]);
    const [guid = null] = await hit.fragments.getGuidsByLocalIds([hit.localId]);
    if (selectionSequence !== this.selectionSequence || activeModel !== this.activeModel) return;
    const selection: ViewerSelection = {
      modelId: hit.fragments.modelId,
      modelName: this.activeModelName,
      globalId: guid,
      expressId: hit.localId,
      localId: hit.localId,
      ifcType: categoryName(item),
      objectType: textAttribute(item, "ObjectType"),
      description: textAttribute(item, "Description"),
      name: textAttribute(item, "Name", "LongName"),
      raw: item,
    };
    this.callbacks.onSelection(selection);

    const payload: SelectionPayload = {
      schemaVersion: 1,
      source: "thatopen",
      model: { id: selection.modelId, name: selection.modelName, path: null },
      element: {
        globalId: selection.globalId,
        expressId: selection.expressId,
        localId: selection.localId,
        ifcType: selection.ifcType,
        objectType: selection.objectType,
        description: selection.description,
        name: selection.name,
      },
      selection: { status: "selected", selectedAt: new Date().toISOString() },
      preview: flattenPreview(item),
    };
    try {
      await api.setSelection(payload);
      this.callbacks.onBridgeProgress({ stage: "ready", detail: selection.name ?? selection.ifcType ?? undefined });
    } catch (error) {
      if (isAuthorizationError(error)) this.callbacks.onAuthorizationRequired(error);
      this.callbacks.onBridgeProgress({ stage: "error", detail: this.errorText(error) });
    }
    this.callbacks.onProgress({ stage: "ready", detail: this.activeModelName });
  }

  private async clearModel() {
    this.fitAnimation = null;
    await this.clearSelection();
    if (!this.activeModel) return;
    const modelId = this.activeModel.modelId;
    this.activeModel = null;
    this.activeModelName = "";
    await this.fragments.disposeModel(modelId);
    this.models.delete(modelId);
    this.grid.position.y = -0.001;
  }

  private async prepareBridge(file: File, modelHash: string, sequence: number) {
    try {
      this.callbacks.onBridgeProgress({ stage: "activating", detail: file.name });
      const activated = await api.tryActivateModel(modelHash);
      this.assertCurrent(sequence);
      if (!activated) {
        this.callbacks.onBridgeProgress({ stage: "uploading", progress: 0, detail: file.name });
        const uploaded = await api.uploadModel(file, (progress) => {
          if (sequence === this.loadSequence) {
            this.callbacks.onBridgeProgress({ stage: "uploading", progress, detail: file.name });
          }
        });
        this.assertCurrent(sequence);
        if (uploaded.modelHash !== modelHash) throw new Error("Backend model hash does not match the local file");
      }
      while (sequence === this.loadSequence) {
        const runtime = await api.runtime();
        this.assertCurrent(sequence);
        if (runtime.prepareError) throw new Error(runtime.prepareError);
        if (runtime.hasActiveModel && !runtime.preparing) {
          this.callbacks.onBridgeProgress({ stage: "ready", detail: file.name });
          return;
        }
        this.callbacks.onBridgeProgress({ stage: "preparing", detail: file.name });
        await wait(2000);
      }
    } catch (error) {
      if (isAuthorizationError(error)) this.callbacks.onAuthorizationRequired(error);
      if (sequence === this.loadSequence && !isLoadCancelledError(error)) {
        this.callbacks.onBridgeProgress({ stage: "error", detail: this.errorText(error) });
      }
    }
  }

  private assertCurrent(sequence: number) {
    if (sequence !== this.loadSequence || this.disposed) throw new LoadCancelledError();
  }

  private publishProgress(sequence: number, progress: ViewerProgress) {
    if (sequence === this.loadSequence && !this.disposed) this.callbacks.onProgress(progress);
  }

  private publishBridge(sequence: number, progress: BridgeProgress) {
    if (sequence === this.loadSequence && !this.disposed) this.callbacks.onBridgeProgress(progress);
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
