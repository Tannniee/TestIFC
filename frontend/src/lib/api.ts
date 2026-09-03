import { sessionFetch, sessionToken } from "./session-transport";
import {
  API_ENDPOINTS,
  apiPath,
  type ActivateModelResponse,
  type StageModelResponse,
  type CacheInventory,
  type FragmentStoredResponse,
  type HealthResponse,
  type LoadModelResponse,
  type ModelRuntimeResponse,
  type SelectionPayload,
  type SelectionResponse,
} from "./api-contracts";

export type {
  ActivateModelResponse,
  FragmentStoredResponse,
  HealthResponse,
  LoadModelResponse,
  ModelRuntimeResponse,
  SelectionElement,
  SelectionPayload,
  SelectionResponse,
} from "./api-contracts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body = "",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function responseMessage(status: number, statusText: string, body: string): string {
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: unknown; detail?: unknown; message?: unknown };
      for (const value of [parsed.error, parsed.message, parsed.detail]) {
        if (typeof value === "string" && value.trim()) return value;
        if (value && typeof value === "object") {
          const nested = value as { error?: unknown; message?: unknown };
          if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
          if (typeof nested.error === "string" && nested.error.trim()) return nested.error;
        }
      }
      return body;
    } catch {
      return body;
    }
  }
  return `${status} ${statusText}`.trim();
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => requestJson<HealthResponse>(API_ENDPOINTS.health.path),
  loadModel(file: File): Promise<LoadModelResponse> {
    const body = new FormData();
    body.append("file", file, file.name);
    return requestJson<LoadModelResponse>(API_ENDPOINTS.loadModel.path, { method: API_ENDPOINTS.loadModel.method, body });
  },
  async uploadModel(file: File, onProgress: (progress: number) => void, signal?: AbortSignal): Promise<LoadModelResponse> {
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const token = await sessionToken();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("Upload cancelled", "AbortError")); return; }
      const body = new FormData();
      body.append("file", file, file.name);
      const request = new XMLHttpRequest();
      request.open(API_ENDPOINTS.loadModel.method, `${API_ENDPOINTS.loadModel.path}?storeOnly=true`);
      if (token) request.setRequestHeader("X-IFC-Session", token);
      const abort = () => request.abort();
      signal?.addEventListener("abort", abort, { once: true });
      request.addEventListener("loadend", () => signal?.removeEventListener("abort", abort));
      request.addEventListener("abort", () => reject(new DOMException("Upload cancelled", "AbortError")));
      request.responseType = "json";
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 300) {
          resolve(request.response as LoadModelResponse);
          return;
        }
        const body = typeof request.response === "string" ? request.response : JSON.stringify(request.response ?? {});
        reject(new ApiError(responseMessage(request.status, request.statusText, body), request.status, body));
      });
      request.addEventListener("error", () => reject(new Error("Model upload failed")));
      request.send(body);
    });
  },
  activateModel(modelHash: string) {
    return requestJson<ActivateModelResponse>(
      apiPath(API_ENDPOINTS.activateModel, { modelHash }),
      { method: API_ENDPOINTS.activateModel.method },
    );
  },
  stageModel(stageId: string, modelHash: string, filename: string) {
    return requestJson<StageModelResponse>("/model/stage", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId, modelHash, filename }), signal: AbortSignal.timeout(120000) });
  },
  stageAction(stageId: string, action: "commit" | "rollback" | "finalize") {
    return requestJson<StageModelResponse>(`/model/stage/${stageId}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }), signal: AbortSignal.timeout(15000) });
  },
  cacheInventory: () => requestJson<CacheInventory>("/model/cache"),
  clearCache: (scope: "fragments" | "all") => requestJson<CacheInventory & { freedBytes: number; failedFiles: number }>("/model/cache/clear", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }),
  }),
  retrySemantic(model: ActivateModelResponse, attemptId: string) {
    return requestJson<{ ok: boolean }>(API_ENDPOINTS.retrySemantic.path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelHash: model.contentHashSha256, loadedAt: model.loadedAt, attemptId }),
    });
  },
  cancelModelLoad(model: ActivateModelResponse) {
    return requestJson<{ ok: boolean; cancelled: boolean }>(API_ENDPOINTS.cancelModelLoad.path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelHash: model.contentHashSha256, loadedAt: model.loadedAt }),
    });
  },
  async tryActivateModel(modelHash: string): Promise<boolean> {
    const response = await sessionFetch(apiPath(API_ENDPOINTS.activateModel, { modelHash }), {
      method: API_ENDPOINTS.activateModel.method,
    });
    if (response.status === 404) return false;
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
    }
    return true;
  },
  runtime: (signal?: AbortSignal) => requestJson<ModelRuntimeResponse>(API_ENDPOINTS.modelRuntime.path, { signal }),
  async getFragments(modelHash: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    const response = await sessionFetch(apiPath(API_ENDPOINTS.getFragments, { modelHash }), { signal });
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
    }
    return response.arrayBuffer();
  },
  async putFragments(modelHash: string, fragments: Uint8Array, signal?: AbortSignal): Promise<void> {
    const response = await sessionFetch(apiPath(API_ENDPOINTS.putFragments, { modelHash }), {
      method: API_ENDPOINTS.putFragments.method,
      headers: { "Content-Type": "application/octet-stream" },
      body: fragments as unknown as BodyInit,
      signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
    }
    await response.json() as FragmentStoredResponse;
  },
  setSelection(selection: SelectionPayload) {
    return requestJson<SelectionResponse>(API_ENDPOINTS.setSelection.path, {
      method: API_ENDPOINTS.setSelection.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    });
  },
  clearSelection() {
    return requestJson<SelectionResponse>(API_ENDPOINTS.clearSelection.path, {
      method: API_ENDPOINTS.clearSelection.method,
    });
  },
};
