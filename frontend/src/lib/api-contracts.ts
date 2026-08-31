export interface HealthResponse {
  ok: boolean;
  service: string;
  schemaVersion: number;
  appVersion: string;
  hasSelection: boolean;
}

export interface AuthStatus {
  authenticated: boolean;
  valid: boolean;
  enforced: boolean;
  authMode: string;
  daysRemaining?: number;
  name?: string;
  email?: string;
  error?: string;
}

export interface ApiActionResponse {
  ok: boolean;
  message?: string;
}

export interface LoadModelResponse {
  ok: boolean;
  modelHash: string;
  originalFilename: string | null;
  sizeBytes: number;
}

export interface ActivateModelResponse {
  ok: boolean;
  path: string;
  contentHashSha256: string;
  originalFilename: string | null;
  sizeBytes: number;
  loadedAt: string;
}

export interface ModelRuntimeResponse {
  hasActiveModel: boolean;
  modelResident: boolean;
  preparing: boolean;
  prepareError: string | null;
  storeBacked: boolean;
  sizeBytes: number;
  liveModelMaxBytes: number;
  idleSeconds: number;
}

export interface SelectionElement {
  globalId: string | null;
  expressId: number | null;
  localId: number | null;
  ifcType: string | null;
  objectType: string | null;
  description: string | null;
  name: string | null;
}

export interface SelectionPayload {
  schemaVersion: number;
  source: string;
  model: { id: string; name: string; path: null };
  element: SelectionElement;
  selection: { status: "selected"; selectedAt: string };
  preview: Record<string, unknown>;
}

export interface SelectionResponse {
  ok: boolean;
  schemaVersion: number;
  hasSelection: boolean;
  data: SelectionPayload | null;
  updatedAt: string | null;
  globalId: string | null;
  expressId: number | null;
  ifcType: string | null;
  objectType: string | null;
  name: string | null;
  modelName: string | null;
}

export interface FragmentStoredResponse {
  ok: boolean;
  modelHash: string;
  sizeBytes: number;
}

export type ApiMethod = "GET" | "POST" | "DELETE";

export interface ApiEndpoint {
  method: ApiMethod;
  path: string;
}

export const API_PROXY_PREFIXES = [
  "/auth",
  "/element",
  "/health",
  "/idea",
  "/load-model",
  "/mass",
  "/model",
  "/register-model",
  "/selection",
] as const;

// Paths are checked against the backend OpenAPI document by the Python contract suite.
export const API_ENDPOINTS = {
  authStatus: { method: "GET", path: "/auth/status" },
  authLogin: { method: "POST", path: "/auth/login" },
  authLogout: { method: "POST", path: "/auth/logout" },
  health: { method: "GET", path: "/health" },
  loadModel: { method: "POST", path: "/load-model" },
  activateModel: { method: "POST", path: "/model/activate/{modelHash}" },
  modelRuntime: { method: "GET", path: "/model/runtime" },
  getFragments: { method: "GET", path: "/model/fragments/{modelHash}" },
  putFragments: { method: "POST", path: "/model/fragments/{modelHash}" },
  setSelection: { method: "POST", path: "/selection" },
  clearSelection: { method: "DELETE", path: "/selection" },
} as const satisfies Record<string, ApiEndpoint>;

export function apiPath(endpoint: ApiEndpoint, parameters: Record<string, string> = {}) {
  return Object.entries(parameters).reduce(
    (path, [name, value]) => path.replace(`{${name}}`, encodeURIComponent(value)),
    endpoint.path,
  );
}
