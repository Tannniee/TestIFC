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
}

export interface LoadModelResponse {
  ok: boolean;
  modelHash: string;
  originalFilename: string;
  sizeBytes: number;
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
  authStatus: () => requestJson<AuthStatus>("/auth/status"),
  health: () => requestJson<HealthResponse>("/health"),
  login: () => requestJson<Record<string, unknown>>("/auth/login", { method: "POST" }),
  logout: () => requestJson<Record<string, unknown>>("/auth/logout", { method: "POST" }),
  loadModel(file: File): Promise<LoadModelResponse> {
    const body = new FormData();
    body.append("file", file, file.name);
    return requestJson<LoadModelResponse>("/load-model", { method: "POST", body });
  },
  uploadModel(file: File, onProgress: (progress: number) => void): Promise<LoadModelResponse> {
    return new Promise((resolve, reject) => {
      const body = new FormData();
      body.append("file", file, file.name);
      const request = new XMLHttpRequest();
      request.open("POST", "/load-model");
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
    return requestJson<{ ok: boolean; modelHash: string }>(`/model/activate/${modelHash}`, { method: "POST" });
  },
  async tryActivateModel(modelHash: string): Promise<boolean> {
    const response = await fetch(`/model/activate/${modelHash}`, { method: "POST" });
    if (response.status === 404) return false;
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
    }
    return true;
  },
  runtime: () => requestJson<ModelRuntimeResponse>("/model/runtime"),
  async getFragments(modelHash: string): Promise<ArrayBuffer | null> {
    const response = await fetch(`/model/fragments/${modelHash}`);
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
    }
    return response.arrayBuffer();
  },
  async putFragments(modelHash: string, fragments: Uint8Array): Promise<void> {
    const response = await fetch(`/model/fragments/${modelHash}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: fragments as unknown as BodyInit,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(responseMessage(response.status, response.statusText, body), response.status, body);
    }
  },
  setSelection(selection: SelectionPayload) {
    return requestJson("/selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    });
  },
  clearSelection() {
    return requestJson("/selection", { method: "DELETE" });
  },
};
