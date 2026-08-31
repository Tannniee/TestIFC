import {
  API_ENDPOINTS,
  apiPath,
  type ActivateModelResponse,
  type ApiActionResponse,
  type AuthStatus,
  type FragmentStoredResponse,
  type HealthResponse,
  type LoadModelResponse,
  type ModelRuntimeResponse,
  type SelectionPayload,
  type SelectionResponse,
} from "./api-contracts";

export type {
  ActivateModelResponse,
  ApiActionResponse,
  AuthStatus,
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

export function isAuthorizationError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
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
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
  }
  return response.json() as Promise<T>;
}

export const api = {
  authStatus: () => requestJson<AuthStatus>(API_ENDPOINTS.authStatus.path),
  health: () => requestJson<HealthResponse>(API_ENDPOINTS.health.path),
  login: () => requestJson<ApiActionResponse>(API_ENDPOINTS.authLogin.path, { method: API_ENDPOINTS.authLogin.method }),
  logout: () => requestJson<ApiActionResponse>(API_ENDPOINTS.authLogout.path, { method: API_ENDPOINTS.authLogout.method }),
  loadModel(file: File): Promise<LoadModelResponse> {
    const body = new FormData();
    body.append("file", file, file.name);
    return requestJson<LoadModelResponse>(API_ENDPOINTS.loadModel.path, { method: API_ENDPOINTS.loadModel.method, body });
  },
  uploadModel(file: File, onProgress: (progress: number) => void): Promise<LoadModelResponse> {
    return new Promise((resolve, reject) => {
      const body = new FormData();
      body.append("file", file, file.name);
      const request = new XMLHttpRequest();
      request.open(API_ENDPOINTS.loadModel.method, API_ENDPOINTS.loadModel.path);
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
  async tryActivateModel(modelHash: string): Promise<boolean> {
    const response = await fetch(apiPath(API_ENDPOINTS.activateModel, { modelHash }), {
      method: API_ENDPOINTS.activateModel.method,
    });
    if (response.status === 404) return false;
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
    }
    return true;
  },
  runtime: () => requestJson<ModelRuntimeResponse>(API_ENDPOINTS.modelRuntime.path),
  async getFragments(modelHash: string): Promise<ArrayBuffer | null> {
    const response = await fetch(apiPath(API_ENDPOINTS.getFragments, { modelHash }));
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
    }
    return response.arrayBuffer();
  },
  async putFragments(modelHash: string, fragments: Uint8Array): Promise<void> {
    const response = await fetch(apiPath(API_ENDPOINTS.putFragments, { modelHash }), {
      method: API_ENDPOINTS.putFragments.method,
      headers: { "Content-Type": "application/octet-stream" },
      body: fragments as unknown as BodyInit,
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
