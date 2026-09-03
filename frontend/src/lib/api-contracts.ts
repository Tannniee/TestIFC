export interface HealthResponse {
  ok: boolean;
  service: string;
  schemaVersion: number;
  appVersion: string;
  hasSelection: boolean;
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

export interface StageModelResponse {
  stageId: string;
  status: "prepared" | "committed" | "rolled_back" | "finalized";
  model: ActivateModelResponse;
}

export interface CacheInventory {
  totalBytes: number; fragmentBytes: number; modelCount: number; protectedModels: number;
  keepModels: number; maxBytes: number;
}

export interface SemanticProgress {
  modelHash: string;
  attemptId: string;
  phase: string;
  completed: number;
  total: number | null;
  category: string | null;
  status: "running" | "ready" | "error";
  error: string | null;
  idleSeconds: number;
  stallAfterSeconds: number;
  stalled: boolean;
}

export interface ModelRuntimeResponse {
  semanticProgress?: SemanticProgress | null;
  hasActiveModel: boolean;
  activeModelHash: string | null;
  activeLoadedAt?: string | null;
  modelResident: boolean;
  preparing: boolean;
  prepareError: string | null;
  hotIndexStatus: "idle" | "indexing" | "ready" | "error";
  coldIndexStatus: "not_configured" | "indexing" | "ready" | "error";
  coldIndexError: string | null;
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
  health: { method: "GET", path: "/health" },
  loadModel: { method: "POST", path: "/load-model" },
  activateModel: { method: "POST", path: "/model/activate/{modelHash}" },
  cancelModelLoad: { method: "POST", path: "/model/cancel-load" },
  retrySemantic: { method: "POST", path: "/model/retry-semantic" },
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
