import { type FragmentsModel } from "@thatopen/fragments";
import * as THREE from "three";
import { markViewerCreated, markViewerDisposed } from "./lifecycle-diagnostics";
import {
  browserFragmentMetadataProfile,
} from "./fragment-profile";
import { ViewerModelLoader, type ModelLoadOptions } from "./viewer-model-loader";
import { FragmentUpdates, RenderScheduler } from "./render-scheduler";
import { ViewerCamera, type CameraUpdateContext } from "./viewer-camera";
import { sectionBoxFromSweep, validSectionBox } from "./viewer-clipping";
import { ClippingController } from "./clipping-controller";
import { SectionBoxController } from "./section-box-controller";
import { validateViewState, type ViewSessionState, type ElementRef, type ClippingSessionState } from "./workspace-contracts";
import { resolveViewSelection } from "./restore-selection";
import type { SectionBoxState } from "./viewer-contracts";
import {
  type CameraOrientation,
  type MeasureMode,
  type SectionPlaneDefinition,
  type SectionSide,
  type ViewDirection,
  type ViewerCallbacks,
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
const FRAGMENTS_MAX_UPDATE_RATE_MS = 50;
const BOX_ZOOM_MIN_SIZE_PX = 8;
export class ViewerService {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly view: ViewerCamera;
  private readonly clipping: ClippingController;
  private selectedRefs: ElementRef[] = [];
  private viewApplySequence = 0;
  private inputBlocked = false;
  private boxDisplay = { showBox: true, showHandles: true };
  private readonly boxController: SectionBoxController;
  private sectionCreation: { source: ViewSessionState; model: FragmentsModel; createView: boolean } | null = null;
  private transientCleanup: Promise<void> = Promise.resolve();
  private readonly interaction: ViewerInteraction;
  private readonly boxZoomRectangle: HTMLDivElement;
  private readonly loader: ViewerModelLoader;
  private readonly scheduler = new RenderScheduler((time) => this.render(time));
  readonly viewDiagnostics = { requests: 0, dispatches: 0, viewEvents: 0, forced: 0, forcedMilliseconds: 0,
    latestCamera: null as CameraUpdateContext | null, reason: "initial", events: [] as Array<Record<string, unknown>> };
  private readonly fragmentUpdates = new FragmentUpdates(async (force) => {
    // With no model, there can be no frame completion event after a delete RPC.
    // Do not await the engine's global fence while restoring an empty viewport.
    if (!this.loader.fragments.models.list.size) { this.scheduler.invalidate(); return; }
    // This adapter owns the cadence; engine throttling must not silently drop a final view.
    const settings = this.loader.fragments.settings;
    const rate = settings.maxUpdateRate;
    settings.maxUpdateRate = 0;
    const started = performance.now();
    this.viewDiagnostics.dispatches++;
    if (force) this.viewDiagnostics.forced++;
    this.recordViewEvent("dispatch", { force, reason: this.viewDiagnostics.reason, camera: this.viewDiagnostics.latestCamera });
    try { await this.loader.fragments.update(force); }
    finally { settings.maxUpdateRate = rate; }
    if (force) this.viewDiagnostics.forcedMilliseconds += performance.now() - started;
    this.recordViewEvent("returned", { force, milliseconds: performance.now() - started });
    this.scheduler.invalidate();
  }, FRAGMENTS_MAX_UPDATE_RATE_MS);
  private readonly fragmentViewUpdated = () => {
    this.viewDiagnostics.viewEvents++;
    // The event carries no revision; do not mislabel it as completion of the latest camera.
    this.recordViewEvent("view-updated", {});
    this.scheduler.invalidate();
  };
  private cameraMoving = false;
  private settledTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly displayPixelRatio = Math.min(window.devicePixelRatio, 2);
  private readonly resizeObserver: ResizeObserver;
  private readonly callbacks: ViewerCallbacks;
  private grid: THREE.GridHelper;
  private gridMaterials: THREE.Material[] = [];
  private viewportBackground: ViewportBackground = "gray";
  private readonly highlights = new ViewerHighlights();
  private activeTool: ViewerTool = "pan";
  private orbitEpoch = 0;
  private hasSelectionOrbit = false;
  private selectionSequence = 0;
  private pointerStart: { id: number; x: number; y: number } | null = null;
  private suppressNextClick = false;
  private boxZoomEnabled = false;
  private boxZoomStart: { id: number; x: number; y: number } | null = null;
  private sectionPickEnabled = false;
  private get sectionDefinition(): SectionPlaneDefinition | null { const s = this.clipping.capture(); return s.kind === "sectionPlane" ? s.definition : null; }
  private get sectionBox(): SectionBoxState | null { const s = this.clipping.capture(); return s.kind === "sectionBox" ? s.box : null; }
  private sectionBoxPicking = false;
  private disposed = false;
  constructor(
    private readonly host: HTMLElement,
    callbacks: ViewerCallbacks,
    fragmentProfile = browserFragmentMetadataProfile(),
  ) {
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.clipping = new ClippingController(this.renderer);
    this.renderer.setPixelRatio(this.displayPixelRatio);
    this.renderer.setClearColor(VIEWPORT_COLORS.gray.background, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-label", "IFC 3D viewport");
    this.host.append(this.renderer.domElement);
    this.view = new ViewerCamera(this.host, this.renderer.domElement, {
      onOrientationChange: (orientation) => this.callbacks.onCameraOrientationChange(orientation),
      onUpdate: (force, context) => this.cameraUpdated(force, context),
    });
    this.loader = new ViewerModelLoader(this.camera, fragmentProfile, {
      onProgress: (value) => callbacks.onProgress(value), onBridgeProgress: (value) => callbacks.onBridgeProgress(value),
      onFragmentMetrics: (value) => callbacks.onFragmentMetrics(value),
      attach: async (model, assertCurrent) => {
        model.onViewUpdated.add(this.fragmentViewUpdated);
        model.getClippingPlanesEvent = () => this.renderer.clippingPlanes;
        this.scene.add(model.object);
        await this.alignGridToIfcElevationZero(model, assertCurrent);
        this.scheduler.invalidate();
      },
      detach: async (model) => {
        if (model) {
          model.onViewUpdated.remove(this.fragmentViewUpdated);
          this.scene.remove(model.object);
        }
        this.scheduler.invalidate();
      },
      capture: () => {
        this.view.cancelAnimation();
        const state = this.captureViewState();
        const gridY = this.grid.position.y;
        return async () => {
          this.grid.position.y = gridY;
          await this.applyViewState(state);
        };
      },
      prepareView: async (state) => {
        this.interaction.reset();
        await this.clearSelection();
        this.clearClipping();
        if (state) await this.applyViewState(state);
      },
      committed: () => {},
      fit: () => this.fit({ animate: false }),
      update: () => this.fragmentUpdates.request(true),
    });
    this.fragments.settings.maxUpdateRate = FRAGMENTS_MAX_UPDATE_RATE_MS;
    this.interaction = new ViewerInteraction(
      this.host,
      this.renderer.domElement,
      this.scene,
      this.camera,
      {
        activeModel: () => this.activeModel,
        onInvalidate: this.scheduler.invalidate,
        onMultiSelection: (result) => void this.applyMultiSelection(result?.fragments ?? null, result?.localIds ?? []),
        onMeasurements: (measurements) => { this.callbacks.onMeasurementChange(measurements); this.callbacks.onViewStateChange?.(); },
      },
    );
    this.boxController = new SectionBoxController(this.host, this.camera,
      (box, force) => {
        this.clipping.apply({ kind: "sectionBox", box });
        this.interaction.setClippingPlanes(this.renderer.clippingPlanes);
        this.boxController.set(box, this.boxDisplay);
        this.callbacks.onSectionBoxChange?.(structuredClone(box));
        if (force) this.callbacks.onViewStateChange?.();
        this.requestFragmentUpdate(force);
      }, enabled => this.view.setEnabled(enabled && !this.inputBlocked && !this.boxZoomEnabled),
      () => this.callbacks.onSectionBoxEdit?.());
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
    this.scheduler.invalidate();
    this.resize();
    markViewerCreated();
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("viewerDebug")) {
      window.dispatchEvent(new CustomEvent("ifc-viewer-ready", { detail: this }));
    }
  }
  private get fragments() { return this.loader.fragments; }
  private get bridge() { return this.loader.bridge; }
  private get activeModel() { return this.loader.activeModel; }
  private get activeModelName() { return this.loader.activeModelName; }
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
    this.scheduler.invalidate();
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
    this.scheduler.invalidate();
    this.scene.add(this.grid);
    this.scheduler.invalidate();
  }
  setWheelZoomSpeed(speed: number) {
    this.view.setZoomSpeed(speed);
  }
  setRotationSpeed(speed: number) { this.view.setRotationSpeed(speed); }
  setTool(tool: ViewerTool) {
    this.cancelSectionBox();
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.cancelAnimation();
    const returnToModel = tool === "pan" && (this.activeTool === "selectOrbit" || this.hasSelectionOrbit);
    const orbitEpoch = ++this.orbitEpoch;
    this.activeTool = tool;
    this.view.setTool(tool);
    this.interaction.setTool(tool);
    if (returnToModel && this.activeModel && !this.inputBlocked) {
      this.hasSelectionOrbit = false;
      this.view.centerOrbit(this.activeModel.box.getCenter(new THREE.Vector3()));
    } else if (tool === "selectOrbit" && this.activeModel && this.selectedRefs.length === 1) {
      void this.centerSelectionOrbit(this.activeModel, this.selectedRefs[0].localId, this.selectionSequence, orbitEpoch);
    }
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

  setBoxZoomEnabled(enabled: boolean, preserveCreation = false) {
    if (enabled) this.orbitEpoch++;
    if (!enabled && !preserveCreation) this.cancelSectionBox();
    if (enabled === this.boxZoomEnabled) return;
    if (enabled && this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.cancelAnimation();
    this.boxZoomEnabled = enabled;
    this.view.setEnabled(!enabled && !this.inputBlocked);
    this.pointerStart = null;
    this.resetBoxZoomDrag();
    this.host.classList.toggle("viewer-box-zoom-active", enabled);
    this.callbacks.onBoxZoomActiveChange(enabled);
    if (!enabled && this.sectionBoxPicking) {
      this.sectionBoxPicking = false;
      this.callbacks.onSectionBoxPickActiveChange?.(false);
    }
  }
  get model() { return this.activeModel; }
  get sectionBoxCreationActive() { return this.sectionCreation !== null; }
  get modelHash() { return this.activeModel?.modelId.slice(0, 64) ?? ""; }
  get artifactId() { return this.loader.artifactId; }
  captureViewState(): ViewSessionState {
    return { schemaVersion: 1, coordinateSpaceVersion: "viewer-v1", camera: this.view.captureSession(),
      clipping: this.clipping.capture(), selection: structuredClone(this.selectedRefs),
      measurements: this.interaction.captureMeasurements(), boxDisplay: { ...this.boxDisplay } };
  }
  async applyViewState(state: ViewSessionState) {
    validateViewState(state);
    const sequence = ++this.viewApplySequence;
    const model = this.activeModel;
    const check = () => { if (sequence !== this.viewApplySequence || model !== this.activeModel || this.disposed) throw new Error("View activation cancelled"); };
    await this.cancelTransientInteraction();
    const wasBlocked = this.inputBlocked;
    this.setInputBlocked(true);
    try {
      await this.clearSelection(); check();
      this.applyClipping(state.clipping);
      this.boxDisplay = { ...state.boxDisplay };
      this.boxController.set(this.sectionBox, this.boxDisplay);
      this.view.restoreSession(state.camera);
      this.interaction.restoreMeasurements(state.measurements);
      if (model && state.selection.length) {
        const ids = await resolveViewSelection(model, state.selection, this.modelHash, this.artifactId, check);
        check(); await this.selectItems(ids, { centerOrbit: false }); check();
      }
      await this.fragmentUpdates.request(true); check();
      this.scheduler.invalidate();
    } finally { if (sequence === this.viewApplySequence) this.setInputBlocked(wasBlocked); }
  }
  cancelTransientInteraction() {
    this.orbitEpoch++;
    this.hasSelectionOrbit = false;
    this.cancelSectionBox();
    this.boxController?.cancel();
    this.view.cancelAnimation();
    this.interaction.cancelTransient();
    this.selectionSequence++;
    this.setBoxZoomEnabled(false);
    this.setSectionPickEnabled(false);
    this.pointerStart = null;
    this.suppressNextClick = true;
    return this.transientCleanup;
  }
  setInputBlocked(blocked: boolean) {
    this.inputBlocked = blocked;
    this.view.setEnabled(!blocked && !this.boxZoomEnabled);
    this.boxController?.setEnabled(!blocked);
  }
  private applyClipping(state: ClippingSessionState) {
    this.clipping.apply(state, this.activeModel?.box.getSize(new THREE.Vector3()).length() ?? 1);
    this.interaction?.setClippingPlanes(this.renderer.clippingPlanes);
    this.boxController?.set(this.sectionBox, this.boxDisplay);
    this.callbacks.onSectionPlaneChange(this.sectionDefinition);
    this.callbacks.onSectionBoxChange?.(this.sectionBox);
    this.callbacks.onViewStateChange?.();
    this.requestFragmentUpdate(true);
  }

  async beginSectionBox(createView = true) {
    await this.cancelTransientInteraction();
    const model = this.activeModel;
    if (!model) return;
    this.setTool("pan");
    const creation = { source: this.captureViewState(), model, createView };
    this.sectionCreation = creation;
    this.applyClipping({ kind: "none" });
    this.sectionBoxPicking = true;
    this.callbacks.onSectionBoxPickActiveChange?.(true);
    this.setInputBlocked(true);
    this.view.setView(model.box, "positiveY", true);
    if (!await this.view.settled() || this.sectionCreation !== creation) return;
    this.setInputBlocked(false);
    this.setBoxZoomEnabled(true);
    this.sectionBoxPicking = true;
    this.callbacks.onBoxZoomActiveChange(false);
    this.callbacks.onSectionBoxPickActiveChange?.(true);
  }
  private cancelSectionBox() {
    const creation = this.sectionCreation;
    if (!creation) return;
    this.sectionCreation = null;
    this.view.cancelAnimation();
    this.view.restoreSession(creation.source.camera);
    this.boxDisplay = { ...creation.source.boxDisplay };
    this.applyClipping(creation.source.clipping);
    this.setInputBlocked(false);
    this.sectionBoxPicking = false;
    this.callbacks.onSectionBoxPickActiveChange?.(false);
    this.transientCleanup = this.transientCleanup.then(async () => {
      if (this.disposed || this.activeModel !== creation.model) return;
      this.interaction.restoreMeasurements(creation.source.measurements);
      await this.selectItems(creation.source.selection.map(ref => ref.localId));
    }).catch(error => this.callbacks.onInteractionError?.(String(error)));
  }

  setSectionBox(box: SectionBoxState) {
    if (!validSectionBox(box)) return;
    this.applyClipping({ kind: "sectionBox", box });
  }

  fitSectionBox() {
    if (!this.activeModel) return;
    const box = this.activeModel.box;
    this.setSectionBox({ enabled: true, min: { ...box.min }, max: { ...box.max } });
  }

  setSectionPickEnabled(enabled: boolean) {
    if (enabled) this.orbitEpoch++;
    if (enabled) this.cancelSectionBox();
    if (enabled === this.sectionPickEnabled) return;
    if (enabled && this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    this.view.cancelAnimation();
    this.sectionPickEnabled = enabled;
    this.view.setEnabled(!this.boxZoomEnabled && !this.inputBlocked);
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
    this.applyClipping({ kind: "sectionPlane", definition: {
      point: { x: point.x, y: point.y, z: point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      side,
    } });
  }

  setSectionSide(side: SectionSide) {
    if (!this.sectionDefinition) return;
    this.setSectionPlane({ ...this.sectionDefinition, side });
  }

  clearSectionPlane() {
    if (this.sectionDefinition) this.clearClipping();
  }
  clearClipping() { this.applyClipping({ kind: "none" }); }
  setBoxDisplay(display: { showBox: boolean; showHandles: boolean }) { this.boxDisplay = { ...display }; this.boxController.set(this.sectionBox, display); this.scheduler.invalidate(); this.callbacks.onViewStateChange?.(); }

  setView(preset: ViewPreset) {
    this.orbitEpoch++;
    const model = this.activeModel;
    if (!model) return;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.setView(model.box, preset);
  }

  setViewDirection(direction: ViewDirection) {
    this.orbitEpoch++;
    const model = this.activeModel;
    if (!model) return;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.setViewDirection(model.box, direction);
  }

  orbitView(deltaAzimuth: number, deltaPolar: number) {
    this.orbitEpoch++;
    if (!this.activeModel) return;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    this.view.orbit(deltaAzimuth, deltaPolar);
  }

  viewSectionPlane() {
    this.orbitEpoch++;
    const model = this.activeModel;
    const section = this.sectionDefinition;
    if (!model || !section) return;
    this.view.viewSection(model.box, section);
  }

  async load(file: File, options: ModelLoadOptions = {}): Promise<void> {
    await this.cancelTransientInteraction();
    await this.highlights.drain();
    await this.loader.load(file, options);
  }
  async closeModel() {
    await this.cancelTransientInteraction();
    const model = this.model, state = this.captureViewState();
    try {
      await this.clearSelection(); this.interaction.reset();
      await this.loader.closeModel(); this.clearClipping(); this.scheduler.invalidate();
    } catch (error) {
      if (model && this.model === model && this.fragments.models.list.has(model.modelId)) await this.applyViewState(state);
      throw error;
    }
  }

  fit({ animate = true }: { animate?: boolean } = {}) {
    this.orbitEpoch++;
    if (this.boxZoomEnabled) this.setBoxZoomEnabled(false);
    if (this.sectionPickEnabled) this.setSectionPickEnabled(false);
    const model = this.activeModel;
    if (!model) return;
    this.view.fit(this.fitBounds(), animate);
  }
  private fitBounds() {
    const bounds = this.activeModel?.box.clone() ?? new THREE.Box3();
    const box = this.sectionBox;
    if (box?.enabled) {
      const clipped = bounds.clone().intersect(new THREE.Box3(new THREE.Vector3(box.min.x,box.min.y,box.min.z), new THREE.Vector3(box.max.x,box.max.y,box.max.z)));
      if (!clipped.isEmpty()) return clipped;
    }
    return bounds;
  }

  async clearSelection() {
    const selectionSequence = ++this.selectionSequence;
    await this.highlights.clear();
    this.scheduler.invalidate();
    if (selectionSequence !== this.selectionSequence) return;
    this.selectedRefs = [];
    this.callbacks.onSelection(null);
    this.callbacks.onMultiSelectionChange(0);
    await this.bridge.clearSelection(() => selectionSequence === this.selectionSequence);
  }

  async retrySemantic() { await this.bridge.retrySemantic(); }
  get needsModelRecovery() { return this.loader.needsRecovery; }
  async recoverModel(check: () => void) {
    const state = this.captureViewState();
    await this.loader.recover(); check();
    await this.applyViewState(state);
  }

  async cancelLoad() {
    await this.loader.cancelLoad();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.view.cancelAnimation();
    this.scheduler.dispose();
    this.endCameraMotion();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown, true);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove, true);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp, true);
    this.renderer.domElement.removeEventListener("pointercancel", this.onPointerCancel, true);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    this.view.dispose();
    this.boxController.dispose();
    this.interaction.dispose();
    try {
      await this.fragmentUpdates.dispose();
    } finally {
      try {
        await this.loader.dispose();
      } finally {
        this.host.classList.remove("viewer-box-zoom-active", "viewer-section-pick-active");
        this.boxZoomRectangle.remove();
        this.disposeGrid(this.grid);
        this.renderer.dispose();
        this.renderer.domElement.remove();
        markViewerDisposed();
      }
    }
  }

  private resize() {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.view.resize(width, height);
    this.requestFragmentUpdate(true);
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

  private async alignGridToIfcElevationZero(model: FragmentsModel, assertCurrent: () => void) {
    try {
      const coordinationMatrix = await model.getCoordinationMatrix();
      assertCurrent();
      const viewerOrigin = new THREE.Vector3().applyMatrix4(coordinationMatrix);
      model.object.updateWorldMatrix(true, false);
      viewerOrigin.applyMatrix4(model.object.matrixWorld);
      if (!Number.isFinite(viewerOrigin.y)) throw new Error("Invalid IFC coordination matrix");
      this.grid.position.y = viewerOrigin.y - 0.001;
    } catch {
      assertCurrent();
      this.grid.position.y = (model.box.isEmpty() ? 0 : model.box.min.y) - 0.001;
    }
  }

  private recordViewEvent(type: string, data: Record<string, unknown>) {
    const events = this.viewDiagnostics.events;
    events.push({ type, at: performance.now(), ...data });
    if (events.length > 240) events.splice(0, events.length - 240);
  }

  private requestFragmentUpdate(force = false, reason = "scene") {
    this.scheduler.invalidate();
    if (!this.loader || this.disposed) return;
    this.viewDiagnostics.requests++;
    this.viewDiagnostics.reason = reason;
    void this.fragmentUpdates.request(force).catch((error) => console.warn("Fragment view update failed", error));
  }

  private cameraUpdated(force: boolean, context?: CameraUpdateContext) {
    if (this.disposed) return;
    this.viewDiagnostics.latestCamera = context ?? null;
    const model = this.loader?.activeModel;
    if (!force && model) {
      if (!this.cameraMoving) {
        this.cameraMoving = true;
        // Dense scenes spend substantial GPU time on pixels during navigation.
        // Keep all geometry; restore full display resolution when damping ends.
        if (this.renderer.info.render.triangles > 2_000_000) {
          this.renderer.setPixelRatio(Math.min(this.displayPixelRatio, 0.75));
        }
      }
      if (this.settledTimer !== null) clearTimeout(this.settledTimer);
      this.settledTimer = setTimeout(() => {
        this.endCameraMotion();
        this.requestFragmentUpdate(true, "settle");
      }, 160);
    }
    if (force) this.endCameraMotion();
    this.requestFragmentUpdate(force, context?.kind ?? "camera");
  }

  private endCameraMotion() {
    if (this.settledTimer !== null) clearTimeout(this.settledTimer);
    this.settledTimer = null;
    if (this.cameraMoving) this.renderer.setPixelRatio(this.displayPixelRatio);
    this.cameraMoving = false;
  }

  private readonly render = (time: number) => {
    const moving = this.view.render(time);
    this.interaction.updateOverlay();
    const opacity = 0.34 * THREE.MathUtils.smoothstep(this.camera.zoom, 0.08, 0.65);
    for (const material of this.gridMaterials) material.opacity = opacity;
    this.renderer.render(this.scene, this.camera);
    this.boxController.update();
    if (this.boxController.visible) {
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      try { this.renderer.clearDepth(); this.clipping.overlay(() => this.renderer.render(this.boxController.scene, this.camera)); }
      finally { this.renderer.autoClear = autoClear; }
    }
    return moving;
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.inputBlocked) { event.stopImmediatePropagation(); return; }
    this.orbitEpoch++;
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
    const sectionBox = this.sectionBoxPicking;
    if (sectionBox && (width < BOX_ZOOM_MIN_SIZE_PX || height < BOX_ZOOM_MIN_SIZE_PX)) { this.resetBoxZoomDrag(); return; }
    this.setBoxZoomEnabled(false, true);
    if (width >= BOX_ZOOM_MIN_SIZE_PX && height >= BOX_ZOOM_MIN_SIZE_PX) {
      if (sectionBox && this.activeModel) {
        this.camera.updateMatrixWorld(true);
        const box = sectionBoxFromSweep(this.camera, this.activeModel.box, { left, top, width, height },
          this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight);
        const bounds = new THREE.Box3(new THREE.Vector3(box.min.x,box.min.y,box.min.z),new THREE.Vector3(box.max.x,box.max.y,box.max.z));
        if (!bounds.intersectsBox(this.activeModel.box)) {
          this.setBoxZoomEnabled(true); this.sectionBoxPicking = true; this.callbacks.onSectionBoxPickActiveChange?.(true);
          this.callbacks.onInteractionError?.("Vùng quét nằm ngoài mô hình. Hãy chọn lại."); return;
        }
        const creation = this.sectionCreation;
        if (!creation) { this.setSectionBox(box); return; }
        this.boxDisplay = { showBox: true, showHandles: true };
        this.setSectionBox(box); this.setInputBlocked(true);
        this.sectionBoxPicking = true; this.callbacks.onSectionBoxPickActiveChange?.(true);
        this.view.fitFromOrientation(this.fitBounds(), creation.source.camera);
        this.transientCleanup = (async () => {
          if (!await this.view.settled() || this.sectionCreation !== creation) return;
          if (creation.createView) { await this.clearSelection(); if (this.sectionCreation !== creation) return; this.interaction.clearMeasurements(); }
          this.sectionCreation = null; this.sectionBoxPicking = false; this.setInputBlocked(false);
          this.callbacks.onSectionBoxPickActiveChange?.(false);
          if (creation.createView) this.callbacks.onSectionBoxCreated?.(this.captureViewState());
          else this.callbacks.onViewStateChange?.();
        })().catch(error => { this.cancelSectionBox(); this.callbacks.onInteractionError?.(String(error)); });
      } else this.zoomToViewportBox(left, top, width, height);
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
    if (this.inputBlocked) return;
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
    const orbitEpoch = this.orbitEpoch;
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
    this.scheduler.invalidate();
    if (selectionSequence !== this.selectionSequence) return;
    await this.highlights.setSingle(hit.fragments, hit.localId);
    this.scheduler.invalidate();
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
    this.selectedRefs = [{ modelHash: this.modelHash, artifactId: this.artifactId, localId: hit.localId, globalId: guid }];
    this.callbacks.onViewStateChange?.();
    await this.centerSelectionOrbit(activeModel, hit.localId, selectionSequence, orbitEpoch);
    await this.bridge.publishSelection(selection, () => selectionSequence === this.selectionSequence && hit.fragments === this.activeModel);
  }

  private async applyMultiSelection(model: FragmentsModel | null, localIds: number[]) {
    const selectionSequence = ++this.selectionSequence;
    await this.highlights.clear();
    this.scheduler.invalidate();
    if (selectionSequence !== this.selectionSequence) return;
    this.callbacks.onSelection(null);
    if (model && localIds.length) {
      await this.highlights.setMultiple(model, localIds);
      this.scheduler.invalidate();
      if (selectionSequence !== this.selectionSequence || model !== this.activeModel) return;
    }
    this.callbacks.onMultiSelectionChange(localIds.length);
    const guids = model && localIds.length ? await model.getGuidsByLocalIds(localIds) : [];
    if (selectionSequence !== this.selectionSequence || (model && model !== this.activeModel)) return;
    this.selectedRefs = localIds.map((localId, i) => ({ modelHash: this.modelHash, artifactId: this.artifactId, localId, globalId: guids[i] ?? null }));
    this.callbacks.onViewStateChange?.();
    await this.bridge.clearSelection(() => selectionSequence === this.selectionSequence);
  }

  async selectItems(localIds: number[], { centerOrbit = true } = {}) {
    const model = this.activeModel;
    if (!model || !localIds.length) { await this.clearSelection(); return; }
    const ids = [...new Set(localIds)];
    if (ids.length !== 1) { await this.applyMultiSelection(model, ids); return; }
    const sequence = ++this.selectionSequence;
    const orbitEpoch = this.orbitEpoch;
    await this.highlights.clear();
    if (sequence !== this.selectionSequence || model !== this.activeModel) return;
    await this.highlights.setSingle(model, ids[0]);
    const [item = null] = await model.getItemsData(ids);
    const [guid = null] = await model.getGuidsByLocalIds(ids);
    if (sequence !== this.selectionSequence || model !== this.activeModel) return;
    const selection = createViewerSelection(model.modelId, this.activeModelName, ids[0], item, guid);
    this.selectedRefs = [{ modelHash: this.modelHash, artifactId: this.artifactId, localId: ids[0], globalId: guid }];
    this.callbacks.onMultiSelectionChange(0);
    this.callbacks.onSelection(selection);
    this.callbacks.onViewStateChange?.();
    this.scheduler.invalidate();
    if (centerOrbit) await this.centerSelectionOrbit(model, ids[0], sequence, orbitEpoch);
    await this.bridge.publishSelection(selection, () => sequence === this.selectionSequence && model === this.activeModel);
  }

  private async centerSelectionOrbit(model: FragmentsModel, localId: number | null, sequence: number, epoch: number) {
    const current = () => !this.disposed && !this.inputBlocked && this.activeTool === "selectOrbit"
      && model === this.activeModel && sequence === this.selectionSequence && epoch === this.orbitEpoch;
    if (localId === null || !current()) return;
    try {
      // Fragments returns world-space bounds, including the model's transform.
      const bounds = await model.getMergedBox([localId]);
      if (!current() || bounds.isEmpty()) return;
      const center = bounds.getCenter(new THREE.Vector3());
      if (!center.toArray().every(Number.isFinite)) return;
      this.hasSelectionOrbit = true;
      this.view.centerOrbit(center);
    } catch (error) {
      if (current()) this.callbacks.onInteractionError?.(`Không thể đặt tâm xoay: ${String(error)}`);
    }
  }

}
