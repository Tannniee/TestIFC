import { FragmentsModels, type FragmentsModel } from "@thatopen/fragments";
import * as THREE from "three";
import { IfcConverter, sha256Hex } from "./ifc-converter";
import { fragmentArrayBuffer } from "./fragment-buffer";
import { markViewerCreated, markViewerDisposed } from "./lifecycle-diagnostics";
import {
  browserFragmentMetadataProfile,
  fragmentCacheKey,
  type FragmentMetadataProfile,
} from "./fragment-profile";
import { ViewerBridge } from "./viewer-bridge";
import { ViewerCamera } from "./viewer-camera";
import {
  LoadCancelledError,
  type BridgeProgress,
  type CameraOrientation,
  type FragmentMetrics,
  type MeasureMode,
  type SectionPlaneDefinition,
  type SectionSide,
  type ViewDirection,
  type ViewerCallbacks,
  type ViewerProgress,
  type ViewerSelection,
  type ViewerTool,
  type ViewportBackground,
  type ViewPreset,
} from "./viewer-contracts";
import { createViewerSelection, ViewerHighlights } from "./viewer-selection";
import { ViewerInteraction } from "./viewer-interaction";

export { isLoadCancelledError, LoadCancelledError } from "./viewer-contracts";
export type * from "./viewer-contracts";

const VIEWPORT_COLORS: Record<ViewportBackground, { background: number; center: number; grid: number }> = {
  gray: { background: 0x20262b, center: 0x596872, grid: 0x354149 },
  white: { background: 0xffffff, center: 0x7a8790, grid: 0xc6cdd2 },
  oled: { background: 0x000000, center: 0x53636d, grid: 0x202a30 },
};
const FRAGMENTS_MAX_UPDATE_RATE_MS = 16;
const BOX_ZOOM_MIN_SIZE_PX = 8;
const SECTION_CLIP_EPSILON_RATIO = 0.00001;
const SECTION_CLIP_EPSILON_MIN = 0.0001;
const SECTION_CLIP_EPSILON_MAX = 0.02;
export class ViewerService {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly view: ViewerCamera;
  private readonly interaction: ViewerInteraction;
  private readonly boxZoomRectangle: HTMLDivElement;
  private readonly fragments = new FragmentsModels("/vendor/fragments/worker.mjs", { maxWorkers: 2 });
  private readonly converter: IfcConverter;
  private readonly fragmentProfile: FragmentMetadataProfile;
  private readonly bridge: ViewerBridge;
  private readonly resizeObserver: ResizeObserver;
  private readonly callbacks: ViewerCallbacks;
  private readonly models = new Map<string, FragmentsModel>();
  private grid: THREE.GridHelper;
  private gridMaterials: THREE.Material[] = [];
  private viewportBackground: ViewportBackground = "gray";
  private activeModel: FragmentsModel | null = null;
  private activeModelName = "";
  private readonly highlights = new ViewerHighlights();
  private activeTool: ViewerTool = "pan";
  private loadSequence = 0;
  private selectionSequence = 0;
  private loadingModelId: string | null = null;
  private pointerStart: { id: number; x: number; y: number } | null = null;
  private suppressNextClick = false;
  private boxZoomEnabled = false;
  private boxZoomStart: { id: number; x: number; y: number } | null = null;
  private sectionPickEnabled = false;
  private sectionDefinition: SectionPlaneDefinition | null = null;
  private disposed = false;
  constructor(
    private readonly host: HTMLElement,
    callbacks: ViewerCallbacks,
    fragmentProfile = browserFragmentMetadataProfile(),
  ) {
    this.callbacks = callbacks;
    this.fragmentProfile = fragmentProfile;
    this.converter = new IfcConverter(fragmentProfile);
    this.bridge = new ViewerBridge({
      onProgress: (progress) => this.publishBridge(progress.loadSequence, progress),
    });
    this.fragments.settings.maxUpdateRate = FRAGMENTS_MAX_UPDATE_RATE_MS;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(VIEWPORT_COLORS.gray.background, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-label", "IFC 3D viewport");
    this.host.append(this.renderer.domElement);
    this.view = new ViewerCamera(this.host, this.renderer.domElement, {
      onOrientationChange: (orientation) => this.callbacks.onCameraOrientationChange(orientation),
      onUpdate: (force) => void this.fragments.update(force),
    });
    this.interaction = new ViewerInteraction(
      this.host,
      this.renderer.domElement,
      this.scene,
      this.camera,
      {
        activeModel: () => this.activeModel,
        onMultiSelection: (result) => void this.applyMultiSelection(result?.fragments ?? null, result?.localIds ?? []),
        onMeasurements: (measurements) => this.callbacks.onMeasurementChange(measurements),
      },
    );
    this.boxZoomRectangle = document.createElement("div");
    this.boxZoomRectangle.className = "viewer-box-zoom-rectangle";
    this.boxZoomRectangle.hidden = true;
    this.host.append(this.boxZoomRectangle);

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
    this.renderer.setAnimationLoop(this.render);
    this.resize();
    markViewerCreated();
  }
  private get camera() {
    return this.view.camera;
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
    return this.view.zoomSpeed;
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
    this.view.setZoomSpeed(speed);
  }
  setTool(tool: ViewerTool) {
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.cancelAnimation();
    this.activeTool = tool;
    this.view.setTool(tool);
    this.interaction.setTool(tool);
  }
  setMeasureMode(mode: MeasureMode) {
    this.interaction.setMeasureMode(mode);
  }
  async quitTool(): Promise<ViewerTool> {
    if (this.activeTool === "measure" && this.interaction.cancelAction()) return "measure";
    if (this.activeTool === "measure" && this.interaction.hasMeasurementState()) {
      this.interaction.clearMeasurements();
      return "measure";
    }
    if (this.activeTool === "multiSelect" && this.interaction.cancelAction()) return "multiSelect";
    if (this.activeTool === "multiSelect" && this.highlights.hasMultiple) {
      await this.clearSelection();
      return "multiSelect";
    }
    this.setTool("pan");
    return "pan";
  }

  setBoxZoomEnabled(enabled: boolean) {
    if (enabled === this.boxZoomEnabled) return;
    if (enabled && this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.cancelAnimation();
    this.boxZoomEnabled = enabled;
    this.view.setEnabled(!enabled);
    this.pointerStart = null;
    this.resetBoxZoomDrag();
    this.host.classList.toggle("viewer-box-zoom-active", enabled);
    this.callbacks.onBoxZoomActiveChange(enabled);
  }

  setSectionPickEnabled(enabled: boolean) {
    if (enabled === this.sectionPickEnabled) return;
    if (enabled && this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    this.view.cancelAnimation();
    this.sectionPickEnabled = enabled;
    this.view.setEnabled(!this.boxZoomEnabled);
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
    if (!model) return;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.setView(model.box, preset);
  }

  setViewDirection(direction: ViewDirection) {
    const model = this.activeModel;
    if (!model) return;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.setViewDirection(model.box, direction);
  }

  orbitView(deltaAzimuth: number, deltaPolar: number) {
    if (!this.activeModel) return;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.orbit(deltaAzimuth, deltaPolar);
  }

  viewSectionPlane() {
    const model = this.activeModel;
    const section = this.sectionDefinition;
    if (!model || !section) return;
    this.view.viewSection(model.box, section);
  }

  async load(file: File): Promise<void> {
    const loadStarted = performance.now();
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.clearSectionPlane();
    this.interaction.reset();
    const sequence = ++this.loadSequence;
    this.bridge.cancelFragmentRequests();
    this.selectionSequence++;
    this.converter.cancel();
    if (this.loadingModelId) this.fragments.abort(this.loadingModelId);
    await this.clearModel();
    this.assertCurrent(sequence);
    this.publishProgress(sequence, { modelHash: null, stage: "reading", detail: file.name });
    const ifcBuffer = await file.arrayBuffer();
    const ifcBytes = ifcBuffer.byteLength;
    this.assertCurrent(sequence);
    const modelHash = await sha256Hex(ifcBuffer);
    this.assertCurrent(sequence);
    void this.bridge.prepareModel(
      file,
      modelHash,
      sequence,
      () => this.assertCurrent(sequence),
    );
    this.publishProgress(sequence, { modelHash, stage: "cache", detail: file.name });
    const cacheKey = fragmentCacheKey(modelHash, this.fragmentProfile);
    let fragmentBuffer: ArrayBuffer | null = null;
    let cacheHit = false;
    let conversionMilliseconds = 0;
    try {
      fragmentBuffer = await this.bridge.fragments(cacheKey);
      cacheHit = fragmentBuffer !== null;
    } catch (error) {
      console.warn(`Fragments cache: ${this.errorText(error)}`);
    }
    this.assertCurrent(sequence);
    if (!fragmentBuffer) {
      this.publishProgress(sequence, { modelHash, stage: "converting", progress: 0, detail: file.name });
      const conversionStarted = performance.now();
      const converted = await this.converter.convert(ifcBuffer, (progress) => {
        this.publishProgress(sequence, { modelHash, stage: "converting", progress, detail: file.name });
      });
      conversionMilliseconds = performance.now() - conversionStarted;
      this.assertCurrent(sequence);
      fragmentBuffer = fragmentArrayBuffer(converted);
      // fetch snapshots the body before Fragments transfers/detaches the buffer.
      this.bridge.cacheFragments(
        cacheKey,
        converted,
        () => sequence === this.loadSequence && !this.disposed,
      );
    }

    const fragmentBytes = fragmentBuffer.byteLength;
    this.publishProgress(sequence, { modelHash, stage: "loading", progress: 0, detail: file.name });
    const modelId = `${modelHash}-${sequence}`;
    this.loadingModelId = modelId;
    let model: FragmentsModel;
    const fragmentLoadStarted = performance.now();
    let fragmentLoadMilliseconds = 0;
    try {
      model = await this.fragments.load(fragmentBuffer, {
        modelId,
        camera: this.camera,
        onProgress: ({ progress }) => this.publishProgress(sequence, { modelHash, stage: "loading", progress, detail: file.name }),
      });
    } catch (error) {
      if (sequence !== this.loadSequence || this.disposed) throw new LoadCancelledError();
      throw error;
    } finally {
      if (this.loadingModelId === modelId) this.loadingModelId = null;
    }
    fragmentLoadMilliseconds = performance.now() - fragmentLoadStarted;
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
    const metrics: FragmentMetrics = {
      loadSequence: sequence,
      modelHash,
      profile: this.fragmentProfile,
      cacheHit,
      ifcBytes,
      fragmentBytes,
      conversionMilliseconds,
      fragmentLoadMilliseconds,
      totalMilliseconds: performance.now() - loadStarted,
    };
    this.publishProgress(sequence, { modelHash, stage: "ready", progress: 1, detail: this.activeModelName });
    this.callbacks.onFragmentMetrics(metrics);
  }

  fit({ animate = true }: { animate?: boolean } = {}) {
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    const model = this.activeModel;
    if (!model) return;
    this.view.fit(model.box, animate);
  }

  async clearSelection() {
    const selectionSequence = ++this.selectionSequence;
    await this.highlights.clear();
    if (selectionSequence !== this.selectionSequence) return;
    this.callbacks.onSelection(null);
    this.callbacks.onMultiSelectionChange(0);
    await this.bridge.clearSelection(() => selectionSequence === this.selectionSequence);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.view.cancelAnimation();
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown, true);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove, true);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp, true);
    this.renderer.domElement.removeEventListener("pointercancel", this.onPointerCancel, true);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    this.view.dispose();
    this.interaction.dispose();
    this.converter.dispose();
    this.bridge.cancelFragmentRequests();
    await this.fragments.dispose();
    this.host.classList.remove("viewer-box-zoom-active");
    this.host.classList.remove("viewer-section-pick-active");
    this.boxZoomRectangle.remove();
    this.disposeGrid(this.grid);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    markViewerDisposed();
  }

  private resize() {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.view.resize(width, height);
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
    this.view.render(time);
    this.interaction.updateOverlay();
    const opacity = 0.34 * THREE.MathUtils.smoothstep(this.camera.zoom, 0.08, 0.65);
    for (const material of this.gridMaterials) material.opacity = opacity;
    this.renderer.render(this.scene, this.camera);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.boxZoomEnabled) {
      this.startBoxZoomDrag(event);
      return;
    }
    if (this.interaction.handlePointerDown(event)) return;
    if (event.button !== 0) return;
    this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.suppressNextClick = false;
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.interaction.handlePointerMove(event)) return;
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
    if (this.interaction.handlePointerUp(event)) return;
    const start = this.pointerStart;
    if (start?.id === event.pointerId) {
      this.suppressNextClick = Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
    }
    this.pointerStart = null;
  };

  private readonly onPointerCancel = (event: PointerEvent) => {
    if (this.interaction.handlePointerCancel(event)) {
      this.suppressNextClick = true;
      return;
    }
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
    this.view.zoomToViewportBox(left, top, width, height, viewportWidth, viewportHeight);
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
    if (this.interaction.handleClick(event)) return;
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
    // FragmentsModels converts viewport coordinates to NDC internally.
    const mouse = new THREE.Vector2(event.clientX, event.clientY);
    const hit = await activeModel.raycast({ camera: this.camera, mouse, dom: this.renderer.domElement });
    if (selectionSequence !== this.selectionSequence || activeModel !== this.activeModel) return;
    if (!hit) {
      await this.clearSelection();
      return;
    }

    await this.highlights.clear();
    if (selectionSequence !== this.selectionSequence) return;
    await this.highlights.setSingle(hit.fragments, hit.localId);
    if (selectionSequence !== this.selectionSequence) return;
    this.callbacks.onMultiSelectionChange(0);

    const [item = null] = await hit.fragments.getItemsData([hit.localId]);
    const [guid = null] = await hit.fragments.getGuidsByLocalIds([hit.localId]);
    if (selectionSequence !== this.selectionSequence || activeModel !== this.activeModel) return;
    const selection = createViewerSelection(
      hit.fragments.modelId,
      this.activeModelName,
      hit.localId,
      item,
      guid,
    );
    this.callbacks.onSelection(selection);
    await this.bridge.publishSelection(selection);
  }

  private async applyMultiSelection(model: FragmentsModel | null, localIds: number[]) {
    const selectionSequence = ++this.selectionSequence;
    await this.highlights.clear();
    if (selectionSequence !== this.selectionSequence) return;
    this.callbacks.onSelection(null);
    if (model && localIds.length) {
      await this.highlights.setMultiple(model, localIds);
      if (selectionSequence !== this.selectionSequence || model !== this.activeModel) return;
    }
    this.callbacks.onMultiSelectionChange(localIds.length);
    await this.bridge.clearSelection(() => selectionSequence === this.selectionSequence);
  }

  private async clearModel() {
    this.view.cancelAnimation();
    await this.clearSelection();
    if (!this.activeModel) return;
    const modelId = this.activeModel.modelId;
    this.activeModel = null;
    this.activeModelName = "";
    await this.fragments.disposeModel(modelId);
    this.models.delete(modelId);
    this.grid.position.y = -0.001;
  }

  private assertCurrent(sequence: number) {
    if (sequence !== this.loadSequence || this.disposed) throw new LoadCancelledError();
  }

  private publishProgress(
    sequence: number,
    progress: Omit<ViewerProgress, "loadSequence">,
  ) {
    if (sequence === this.loadSequence && !this.disposed) {
      this.callbacks.onProgress({ ...progress, loadSequence: sequence });
    }
  }

  private publishBridge(sequence: number, progress: BridgeProgress) {
    if (sequence === this.loadSequence && !this.disposed) this.callbacks.onBridgeProgress(progress);
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
