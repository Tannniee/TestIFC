import type { Locale } from "./i18n";
import type { ViewportBackground } from "./viewer-contracts";

export interface AppSettings {
  schemaVersion: 1;
  locale: Locale;
  mode: "light" | "dark";
  gridVisible: boolean;
  viewportBackground: ViewportBackground;
  wheelZoomSpeed: number;
}

interface DesktopSettingsApi {
  get_api_session(): Promise<{ token: string }>;
  load_settings(): Promise<unknown>;
  save_settings(settings: AppSettings): Promise<unknown>;
}

declare global {
  interface Window {
    pywebview?: { api?: Partial<DesktopSettingsApi> };
  }
}

let desktopApiPromise: Promise<DesktopSettingsApi | null> | null = null;

function isDesktopSettingsApi(value: unknown): value is DesktopSettingsApi {
  const candidate = value as Partial<DesktopSettingsApi> | undefined;
  return typeof candidate?.load_settings === "function" && typeof candidate?.save_settings === "function";
}

function waitForDesktopApi(): Promise<DesktopSettingsApi | null> {
  if (desktopApiPromise) return desktopApiPromise;
  desktopApiPromise = new Promise((resolve) => {
    const current = window.pywebview?.api;
    if (isDesktopSettingsApi(current)) {
      resolve(current);
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      document.removeEventListener("pywebviewready", finish);
      const api = window.pywebview?.api;
      resolve(isDesktopSettingsApi(api) ? api : null);
    };
    const timeout = window.setTimeout(finish, 500);
    document.addEventListener("pywebviewready", finish, { once: true });
  });
  return desktopApiPromise;
}

function normalizeSettings(value: unknown): AppSettings | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<AppSettings>;
  if (source.locale !== "vi" && source.locale !== "en") return null;
  if (source.mode !== "light" && source.mode !== "dark") return null;
  if (typeof source.gridVisible !== "boolean") return null;
  if (!source.viewportBackground || !["gray", "white", "oled"].includes(source.viewportBackground)) return null;
  if (typeof source.wheelZoomSpeed !== "number" || !Number.isFinite(source.wheelZoomSpeed)) return null;
  if (source.wheelZoomSpeed < 0.25 || source.wheelZoomSpeed > 3) return null;
  return {
    schemaVersion: 1,
    locale: source.locale,
    mode: source.mode,
    gridVisible: source.gridVisible,
    viewportBackground: source.viewportBackground,
    wheelZoomSpeed: source.wheelZoomSpeed,
  };
}

export async function loadDesktopSettings(): Promise<AppSettings | null> {
  const api = await waitForDesktopApi();
  if (!api) return null;
  try {
    return normalizeSettings(await api.load_settings());
  } catch {
    return null;
  }
}

export async function saveDesktopSettings(settings: AppSettings): Promise<void> {
  const api = await waitForDesktopApi();
  if (!api) return;
  try {
    await api.save_settings(settings);
  } catch {
    // localStorage remains the browser-development fallback.
  }
}
