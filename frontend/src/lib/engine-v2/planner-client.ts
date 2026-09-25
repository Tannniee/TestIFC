import type { EngineV2ArtifactBuffers } from "./artifact-reader.ts";
import type { EngineV2PagePayload, EngineV2PlannerOptions, EngineV2PlannerReady } from "./planner-contracts.ts";

type PlannerResult = EngineV2PlannerReady | EngineV2PagePayload;
type PlannerResponse =
  | { type: "ready" | "page"; requestId: number; result: PlannerResult }
  | { type: "error"; requestId: number; name: string; message: string };

interface PendingRequest {
  resolve(value: PlannerResult): void;
  reject(reason: unknown): void;
  cleanup(): void;
}

export class EngineV2PlannerClient {
  private readonly worker = new Worker(new URL("./planner.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;

  constructor() {
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onWorkerError);
  }

  initialize(
    artifact: EngineV2ArtifactBuffers,
    signal?: AbortSignal,
    options?: Partial<EngineV2PlannerOptions>,
  ): Promise<EngineV2PlannerReady> {
    const transfer = Object.values(artifact.chunks).map(buffer => buffer as Transferable);
    return this.request<EngineV2PlannerReady>({ type: "initialize", artifact, options }, transfer, signal);
  }

  buildPage(pageId: string, signal?: AbortSignal): Promise<EngineV2PagePayload> {
    return this.request<EngineV2PagePayload>({ type: "page", pageId }, [], signal);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.postMessage({ type: "dispose", requestId: 0 });
    this.worker.terminate();
    const error = new DOMException("Engine V2 planner disposed", "AbortError");
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
  }

  private request<T extends PlannerResult>(
    message: { type: "initialize"; artifact: EngineV2ArtifactBuffers; options?: Partial<EngineV2PlannerOptions> }
      | { type: "page"; pageId: string },
    transfer: Transferable[],
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new DOMException("Engine V2 planner disposed", "AbortError"));
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Engine V2 planning cancelled", "AbortError"));
    const requestId = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.cleanup();
        this.worker.postMessage({ type: "cancel", requestId });
        reject(signal?.reason ?? new DOMException("Engine V2 planning cancelled", "AbortError"));
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(requestId, {
        resolve: value => resolve(value as T),
        reject,
        cleanup,
      });
      this.worker.postMessage({ ...message, requestId }, transfer);
    });
  }

  private readonly onMessage = (event: MessageEvent<PlannerResponse>) => {
    const response = event.data;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    pending.cleanup();
    if (response.type === "error") {
      const error = new Error(response.message);
      error.name = response.name;
      pending.reject(error);
    } else {
      pending.resolve(response.result);
    }
  };

  private readonly onWorkerError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || "Engine V2 planner failed");
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
  };
}
