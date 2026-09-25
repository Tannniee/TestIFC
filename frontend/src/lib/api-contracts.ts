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
  semanticMode: "legacy" | "native";
}

export interface StageModelResponse {
  stageId: string;
  status: "prepared" | "committed" | "rolled_back" | "finalized";
  model: ActivateModelResponse;
}

export interface CacheInventory {
  totalBytes: number; fragmentBytes: number; engineV2Bytes: number; modelCount: number; protectedModels: number;
  keepModels: number; maxBytes: number;
}

export interface EngineV2JobResponse {
  jobId: string;
  modelHash: string;
  artifactKey: string;
  state: "queued" | "running" | "ready" | "error" | "cancelled";
  phase: string;
  ready: boolean;
  error: string | null;
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
  semanticMode: "legacy" | "native" | null;
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

export interface ModelTreeNode {
  globalId: string | null;
  expressId: number;
  ifcType: string;
  name: string | null;
  objectType: string | null;
  children: ModelTreeNode[];
}

export interface ModelTreeResponse { ok: boolean; roots: ModelTreeNode[]; rootCount: number }
export type ElementRecord = Record<string, unknown> & {
  globalId?: string | null; expressId?: number; ifcType?: string; name?: string | null;
  objectType?: string | null; description?: string | null;
};
export interface ElementsResponse {
  localIds: number[]; globalIds: string[];
  byLocalId: Array<ElementRecord | null>; byGlobalId: Array<ElementRecord | null>;
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
  modelSource: { method: "GET", path: "/model/source/{modelHash}" },
  modelTree: { method: "GET", path: "/model/tree" },
  modelElements: { method: "POST", path: "/model/elements" },
  getFragments: { method: "GET", path: "/model/fragments/{modelHash}" },
  putFragments: { method: "POST", path: "/model/fragments/{modelHash}" },
  prepareEngineV2: { method: "POST", path: "/model/engine-v2/{modelHash}/prepare" },
  engineV2Job: { method: "GET", path: "/model/engine-v2/jobs/{jobId}" },
  cancelEngineV2Job: { method: "DELETE", path: "/model/engine-v2/jobs/{jobId}" },
  engineV2Manifest: { method: "GET", path: "/model/engine-v2/artifacts/{artifactKey}/manifest" },
  engineV2Chunk: { method: "GET", path: "/model/engine-v2/artifacts/{artifactKey}/chunks/{file}" },
  setSelection: { method: "POST", path: "/selection" },
  clearSelection: { method: "DELETE", path: "/selection" },
} as const satisfies Record<string, ApiEndpoint>;

export function apiPath(endpoint: ApiEndpoint, parameters: Record<string, string> = {}) {
  return Object.entries(parameters).reduce(
    (path, [name, value]) => path.replace(`{${name}}`, encodeURIComponent(value)),
    endpoint.path,
  );
}
