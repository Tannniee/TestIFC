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

export interface BimElementResponse {
  modelHash: string;
  coldStatus: ModelRuntimeResponse["coldIndexStatus"];
  element: import("./bim-properties").BimElementRecord;
}

export interface ModelGeoreferenceResponse {
  modelHash: string;
  status: "projected" | "unavailable";
  source: "ifc" | null;
  reason?: string;
  crsName?: string;
  mapUnit?: string | null;
  origin?: { eastings: number; northings: number; height: number };
  mapConversion?: { eastings: number; northings: number; height: number;
    xAxisAbscissa: number; xAxisOrdinate: number; scale: number;
    factorX: number; factorY: number; factorZ: number };
  wgs84?: {
    controlPoints: Record<"origin" | "east" | "north" | "up",
      { longitude: number; latitude: number; elevationMeters: number }>;
    projectUnitMeters: number; verticalDatumVerified: boolean;
  } | null;
}

export type BrowserView = "spatial" | "systems" | "types" | "groups" | "classification" | "material";
export interface ModelBrowserResponse {
  modelHash: string;
  view: BrowserView;
  coldStatus: ModelRuntimeResponse["coldIndexStatus"];
  elements: Array<{ localId: number; globalId: string | null; ifcType: string; name: string | null }>;
  facets: Array<{ key: string; label: string; localId: number }>;
}
export interface SemanticSearchRequest {
  kind: "pset" | "qto"; setName: string; propertyName: string;
  op: "eq" | "contains" | "gt" | "gte" | "lt" | "lte";
  value: string; ifcType: string; limit?: number;
}
export interface SemanticSearchResponse {
  modelHash: string;
  coldStatus: ModelRuntimeResponse["coldIndexStatus"];
  truncated: boolean;
  results: Array<{ localId: number; globalId: string | null; ifcType: string;
    name: string | null; value: string; unit: string | null }>;
}
export type SemanticCondition = Pick<SemanticSearchRequest, "kind" | "setName" | "propertyName" | "op" | "value">;
export interface SemanticFilterRequest { conditions: SemanticCondition[]; match: "all" | "any"; ifcType: string; cursor?: number; limit?: number }
export interface SemanticFilterResponse { modelHash: string; coldStatus: ModelRuntimeResponse["coldIndexStatus"]; total: number; truncated: boolean; nextCursor: number | null;
  results: Array<{localId: number;globalId: string | null;ifcType: string;name: string | null}> }
export interface SemanticFieldCatalog { modelHash: string; coldStatus: ModelRuntimeResponse["coldIndexStatus"]; truncated: boolean;
  fields: Array<{kind: "pset" | "qto";setName: string;propertyName: string;unit: string | null;count: number}> }
export interface ManualAnchor {
  longitude: number; latitude: number; elevationMeters: number;
  rotationDegrees: number; scale: number;
  /** Selected road datum measured up from the model's bottom, before scale. */
  groundOffsetMeters?: number;
}
export interface GisAnchorResponse {
  modelHash: string; status: "manual" | "unavailable"; source: "manual" | null;
  anchor?: ManualAnchor; updatedAt?: string;
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
  modelGeoreference: { method: "GET", path: "/model/georeference" },
  modelBrowser: { method: "GET", path: "/model/browser" },
  semanticSearch: { method: "GET", path: "/model/semantic-search" },
  semanticFilter: { method: "POST", path: "/model/semantic-search" },
  semanticFields: { method: "GET", path: "/model/semantic-fields" },
  gisAnchor: { method: "GET", path: "/model/gis-anchor" },
  bimElement: { method: "GET", path: "/element/by-express-id/{expressId}/bim" },
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
