import { api, type HealthResponse } from "./api";
import { loadDesktopSettings, saveDesktopSettings, type AppSettings } from "./settings";
import { ViewerService } from "./viewer";
import { isLoadCancelledError } from "./viewer-contracts";
import type {
  SectionPlaneDefinition,
  SectionSide,
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
  SectionPlaneDefinition,
  SectionSide,
  ViewDirection,
  ViewerCallbacks,
  ViewerProgress,
  ViewerSelection,
  ViewportBackground,
  ViewPreset,
} from "./viewer-contracts";

export class AppShellService {
  private viewer: ViewerService | null = null;
  private settingsInitialized = false;
  private settingsSaveTimer: number | null = null;

  readLocalSettings(): AppSettings {
    const savedLocale = localStorage.getItem("ifc-viewer-locale");
    const savedMode = localStorage.getItem("ifc-viewer-theme");
    const savedBackground = localStorage.getItem("ifc-viewer-background");
    const savedZoomSpeed = Number(localStorage.getItem("ifc-viewer-wheel-zoom-speed"));
    return {
      schemaVersion: 1,
      locale: savedLocale === "en" ? "en" : "vi",
      mode: savedMode === "dark" ? "dark" : "light",
      gridVisible: localStorage.getItem("ifc-viewer-grid") !== "hidden",
      viewportBackground: savedBackground === "white" || savedBackground === "oled" ? savedBackground : "gray",
      wheelZoomSpeed: Number.isFinite(savedZoomSpeed) && savedZoomSpeed >= 0.25 && savedZoomSpeed <= 3 ? savedZoomSpeed : 1,
    };
  }

  async initializeViewer(host: HTMLElement, callbacks: ViewerCallbacks, fallback: AppSettings): Promise<AppSettings> {
    const desktopSettings = await loadDesktopSettings();
    const settings = desktopSettings ?? fallback;
    this.viewer = new ViewerService(host, callbacks);
    this.applyViewerSettings(settings);
    this.settingsInitialized = true;
    if (!desktopSettings) void saveDesktopSettings(settings);
    return settings;
  }

  applyViewerSettings(settings: AppSettings) {
    this.viewer?.setBackground(settings.viewportBackground);
    this.viewer?.setGridVisible(settings.gridVisible);
    this.viewer?.setWheelZoomSpeed(settings.wheelZoomSpeed);
  }

  persistSettings(settings: AppSettings, delay = 0) {
    localStorage.setItem("ifc-viewer-locale", settings.locale);
    localStorage.setItem("ifc-viewer-theme", settings.mode);
    localStorage.setItem("ifc-viewer-grid", settings.gridVisible ? "visible" : "hidden");
    localStorage.setItem("ifc-viewer-background", settings.viewportBackground);
    localStorage.setItem("ifc-viewer-wheel-zoom-speed", String(settings.wheelZoomSpeed));
    if (!this.settingsInitialized) return;
    if (this.settingsSaveTimer !== null) window.clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = window.setTimeout(() => {
      this.settingsSaveTimer = null;
      void saveDesktopSettings(settings);
    }, delay);
  }

  health(): Promise<HealthResponse> {
    return api.health();
  }

  isCancelledLoad(error: unknown) {
    return isLoadCancelledError(error);
  }

  load(file: File) {
    return this.viewer?.load(file) ?? Promise.resolve();
  }

  fit() {
    this.viewer?.fit();
  }

  setBoxZoomEnabled(enabled: boolean) {
    this.viewer?.setBoxZoomEnabled(enabled);
  }

  setSectionPickEnabled(enabled: boolean) {
    this.viewer?.setSectionPickEnabled(enabled);
  }

  setSectionPlane(definition: SectionPlaneDefinition) {
    this.viewer?.setSectionPlane(definition);
  }

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

  async dispose() {
    this.settingsInitialized = false;
    if (this.settingsSaveTimer !== null) {
      window.clearTimeout(this.settingsSaveTimer);
      this.settingsSaveTimer = null;
    }
    const viewer = this.viewer;
    this.viewer = null;
    await viewer?.dispose();
  }
}
