import { EngineV2BinaryTables } from "./binary-tables.ts";
import { EngineV2PlannerCore } from "./planner-core.ts";
import type { EngineV2ArtifactBuffers } from "./artifact-reader.ts";
import type { EngineV2PagePayload, EngineV2PlannerOptions, EngineV2PlannerReady } from "./planner-contracts.ts";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<PlannerRequest>) => void): void;
  postMessage(message: PlannerResponse, transfer?: Transferable[]): void;
  close(): void;
}

type PlannerRequest =
  | { type: "initialize"; requestId: number; artifact: EngineV2ArtifactBuffers; options?: Partial<EngineV2PlannerOptions> }
  | { type: "page"; requestId: number; pageId: string }
  | { type: "cancel"; requestId: number }
  | { type: "dispose"; requestId: number };

type PlannerResponse =
  | { type: "ready"; requestId: number; result: EngineV2PlannerReady }
  | { type: "page"; requestId: number; result: EngineV2PagePayload }
  | { type: "error"; requestId: number; name: string; message: string };

const scope = self as unknown as WorkerScope;
const cancelled = new Set<number>();
let planner: EngineV2PlannerCore | null = null;
let activeRequest = 0;
let queue: Promise<void> = Promise.resolve();

const yieldControl = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const isCancelled = () => cancelled.has(activeRequest);

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.requestId);
    return;
  }
  if (request.type === "dispose") {
    scope.close();
    return;
  }
  queue = queue.then(() => execute(request));
});

async function execute(request: Extract<PlannerRequest, { type: "initialize" | "page" }>) {
  activeRequest = request.requestId;
  try {
    if (request.type === "initialize") {
      planner = new EngineV2PlannerCore(new EngineV2BinaryTables(request.artifact), request.options, {
        cancelled: isCancelled,
        yieldControl,
      });
      const result = await planner.initialize();
      scope.postMessage({ type: "ready", requestId: request.requestId, result }, [
        result.productIds.buffer,
        result.productTypeIds.buffer,
        result.productMaterialOrdinals.buffer,
        result.productBounds.buffer,
      ]);
    } else {
      if (!planner) throw new Error("Engine V2 planner is not initialized");
      const result = await planner.buildPage(request.pageId);
      const transfer: Transferable[] = [];
      for (const cluster of result.clusters) transfer.push(cluster.positions.buffer, cluster.normals.buffer, cluster.indices.buffer);
      for (const instance of result.instances) transfer.push(instance.matrix.buffer);
      scope.postMessage({ type: "page", requestId: request.requestId, result }, transfer);
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    scope.postMessage({ type: "error", requestId: request.requestId, name: failure.name, message: failure.message });
  } finally {
    cancelled.delete(request.requestId);
    if (activeRequest === request.requestId) activeRequest = 0;
  }
}
