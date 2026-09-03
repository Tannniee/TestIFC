import { api, type HealthResponse } from "./api";
import { loadDesktopSettings, saveDesktopSettings, type AppSettings } from "./settings";
import { ViewerService } from "./viewer";
import { WorkspaceManager } from "./workspace-manager";
import { ModelDataService } from "./model-data-service";
import { activeView, emptyWorkspace, type WorkspaceState } from "./workspace-contracts";
import { isLoadCancelledError } from "./viewer-contracts";
import type {
  SectionPlaneDefinition,
  SectionBoxState,
  SectionSide,
  MeasureMode,
  ViewerTool,
  ViewDirection,
  ViewerCallbacks,
  ViewportBackground,
  ViewPreset,
} from "./viewer-contracts";

export type { AppSettings } from "./settings";
export type {
  BridgeProgress,
  CameraOrientation,
  FragmentMetrics,
  MeasureMode,
  MeasurementResult,
  SectionPlaneDefinition,
  SectionSide,
  ViewDirection,
  ViewerCallbacks,
  ViewerProgress,
  ViewerSelection,
  ViewerTool,
  ViewportBackground,
  ViewPreset,
} from "./viewer-contracts";

export class AppShellService {
  private viewer: ViewerService | null = null;
  private workspace: WorkspaceManager | null = null;
  readonly modelData = new ModelDataService(() => this.activeModel);
  private workspaceListeners = new Set<(state: WorkspaceState) => void>();
  subscribeWorkspace(listener: (state: WorkspaceState) => void) {
    this.workspaceListeners.add(listener); listener(this.workspace?.snapshot() ?? emptyWorkspace());
    return () => { this.workspaceListeners.delete(listener); };
  }
  activateDocument(id: string) { return this.workspace?.activateDocument(id) ?? Promise.resolve(); }
  activateView(id: string) { return this.workspace?.activateView(id) ?? Promise.resolve(); }
  closeDocument(id: string) { return this.workspace?.closeDocument(id) ?? Promise.resolve(); }
  closeView(id: string) { return this.workspace?.closeView(id) ?? Promise.resolve(); }
  setBoxDisplay(display: { showBox: boolean; showHandles: boolean }) { this.viewer?.setBoxDisplay(display); }
  selectItems(ids: number[]) { return this.viewer?.selectItems(ids) ?? Promise.resolve(); }
  get activeModel() { return this.viewer?.model ?? null; }
  setExpandedNodes(ids: string[]) { this.workspace?.setExpandedNodes(ids); }
  private settingsInitialized = false;
  private settingsSaveTimer: number | null = null;

  readLocalSettings(): AppSettings {
    const savedLocale = localStorage.getItem("ifc-viewer-locale");
    const savedMode = localStorage.getItem("ifc-viewer-theme");
    const savedBackground = localStorage.getItem("ifc-viewer-background");
    const savedZoomSpeed = Number(localStorage.getItem("ifc-viewer-wheel-zoom-speed"));
    const savedRotationSpeed = Number(localStorage.getItem("ifc-viewer-rotation-speed"));
    return {
      schemaVersion: 1,
      locale: savedLocale === "en" ? "en" : "vi",
      mode: savedMode === "dark" ? "dark" : "light",
      gridVisible: localStorage.getItem("ifc-viewer-grid") !== "hidden",
      viewportBackground: savedBackground === "white" || savedBackground === "oled" ? savedBackground : "gray",
      wheelZoomSpeed: Number.isFinite(savedZoomSpeed) && savedZoomSpeed >= 0.25 && savedZoomSpeed <= 3 ? savedZoomSpeed : 1,
      rotationSpeed: Number.isFinite(savedRotationSpeed) && savedRotationSpeed >= 0.25 && savedRotationSpeed <= 3 ? savedRotationSpeed : 1,
    };
  }

  async initializeViewer(host: HTMLElement, callbacks: ViewerCallbacks, fallback: AppSettings): Promise<AppSettings> {
    const desktopSettings = await loadDesktopSettings();
    const settings = desktopSettings ?? fallback;
    this.viewer = new ViewerService(host, {
      ...callbacks,
      onProgress: progress => { this.workspace?.geometry(progress); callbacks.onProgress(progress); },
      onBridgeProgress: progress => { this.workspace?.semantic(progress); callbacks.onBridgeProgress(progress); },
      onViewStateChange: () => { this.workspace?.changed(); callbacks.onViewStateChange?.(); },
      onSectionBoxCreated: state => { this.workspace?.sectionBoxCreated(state); callbacks.onSectionBoxCreated?.(state); },
    });
    this.workspace = new WorkspaceManager(this.viewer);
    let modelOwner = this.viewer.model;
    this.workspace.subscribe(state => {
      if (this.viewer?.model !== modelOwner) { modelOwner = this.viewer?.model ?? null; this.modelData.clear(); }
      for (const listener of this.workspaceListeners) listener(state);
    });
    this.applyViewerSettings(settings);
    this.settingsInitialized = true;
    if (!desktopSettings) void saveDesktopSettings(settings);
    return settings;
  }

  applyViewerSettings(settings: AppSettings) {
    this.viewer?.setBackground(settings.viewportBackground);
    this.viewer?.setGridVisible(settings.gridVisible);
    this.viewer?.setWheelZoomSpeed(settings.wheelZoomSpeed);
    this.viewer?.setRotationSpeed(settings.rotationSpeed);
  }

  persistSettings(settings: AppSettings, delay = 0) {
    localStorage.setItem("ifc-viewer-locale", settings.locale);
    localStorage.setItem("ifc-viewer-theme", settings.mode);
    localStorage.setItem("ifc-viewer-grid", settings.gridVisible ? "visible" : "hidden");
    localStorage.setItem("ifc-viewer-background", settings.viewportBackground);
    localStorage.setItem("ifc-viewer-wheel-zoom-speed", String(settings.wheelZoomSpeed));
    localStorage.setItem("ifc-viewer-rotation-speed", String(settings.rotationSpeed));
    if (!this.settingsInitialized) return;
    if (this.settingsSaveTimer !== null) window.clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = window.setTimeout(() => {
      this.settingsSaveTimer = null;
      void saveDesktopSettings(settings);
    }, delay);
  }

  async retrySemantic() { await this.workspace?.retrySemantic(); }
  cacheInventory() { return api.cacheInventory(); }
  clearCache(scope: "fragments" | "all") { return api.clearCache(scope); }

  health(): Promise<HealthResponse> {
    return api.health();
  }

  isCancelledLoad(error: unknown) {
    return isLoadCancelledError(error);
  }

  load(file: File) {
    return this.workspace?.openDocument(file) ?? Promise.resolve();
  }

  cancelLoad() {
    return this.workspace?.cancel() ?? Promise.resolve();
  }

  fit() {
    this.viewer?.fit();
  }

  setBoxZoomEnabled(enabled: boolean) {
    this.viewer?.setBoxZoomEnabled(enabled);
  }

  setTool(tool: ViewerTool) {
    this.viewer?.setTool(tool);
  }

  setMeasureMode(mode: MeasureMode) {
    this.viewer?.setMeasureMode(mode);
  }

  quitTool() {
    return this.viewer?.quitTool() ?? Promise.resolve<ViewerTool>("pan");
  }

  setSectionPickEnabled(enabled: boolean) {
    if (enabled && this.workspace && activeView(this.workspace.snapshot())?.type === "sectionBox") return;
    this.viewer?.setSectionPickEnabled(enabled);
  }

  setSectionPlane(definition: SectionPlaneDefinition) {
    if (this.workspace && activeView(this.workspace.snapshot())?.type === "sectionBox") return;
    this.viewer?.setSectionPlane(definition);
  }

  beginSectionBox(redraw = false) { return this.workspace?.beginSectionBox(redraw) ?? Promise.resolve(); }
  setSectionBox(box: SectionBoxState) { this.viewer?.setSectionBox(box); }
  fitSectionBox() { this.viewer?.fitSectionBox(); }

  setSectionSide(side: SectionSide) {
    this.viewer?.setSectionSide(side);
  }

  clearSectionPlane() {
    this.viewer?.clearSectionPlane();
  }

  viewSectionPlane() {
    this.viewer?.viewSectionPlane();
  }

  setView(preset: ViewPreset) {
    this.viewer?.setView(preset);
  }

  setViewDirection(direction: ViewDirection) {
    this.viewer?.setViewDirection(direction);
  }

  orbitView(deltaAzimuth: number, deltaPolar: number) {
    this.viewer?.orbitView(deltaAzimuth, deltaPolar);
  }

  setGridVisible(visible: boolean) {
    this.viewer?.setGridVisible(visible);
  }

  setBackground(background: ViewportBackground) {
    this.viewer?.setBackground(background);
  }

  setWheelZoomSpeed(speed: number) {
    this.viewer?.setWheelZoomSpeed(speed);
  }

  setRotationSpeed(speed: number) { this.viewer?.setRotationSpeed(speed); }

  async dispose() {
    this.settingsInitialized = false;
    if (this.settingsSaveTimer !== null) {
      window.clearTimeout(this.settingsSaveTimer);
      this.settingsSaveTimer = null;
    }
    const viewer = this.viewer;
    try { await this.workspace?.dispose(); }
    finally {
      this.workspace = null; this.workspaceListeners.clear();
      this.modelData.clear(); this.viewer = null;
      await viewer?.dispose();
    }
  }
}
