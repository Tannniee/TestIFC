import { api, ApiError } from "./api";
import type { ActivateModelResponse, StageModelResponse } from "./api-contracts";
import { ModelSourceError } from "./model-source-error";

/** Mutations are idempotent by stage ID: retry a lost reply without another activation. */
async function retry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt === 2 || (error instanceof ApiError && error.status < 500)) throw error;
    }
  }
}

export class ModelStage {
  static isConflict(error: unknown) { return error instanceof ApiError && error.status === 409; }
  static async assertActive(activation: ActivateModelResponse | null) {
    const runtime = await api.runtime();
    if (runtime.activeModelHash !== (activation?.contentHashSha256 ?? null)
      || (activation && runtime.activeLoadedAt !== activation.loadedAt)) throw new ApiError("active_model_generation_changed", 409);
  }
  private constructor(readonly id: string, readonly prepared: StageModelResponse) {}
  static async prepare(file: File, hash: string, signal: AbortSignal, progress: (value: number) => void) {
    const id = crypto.randomUUID();
    const prepare = () => retry(() => api.stageModel(id, hash, file.name));
    let response: StageModelResponse;
    try { response = await prepare(); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      // A retained browser File can become unreadable after deletion/replacement.
      // Probe only when the cached IFC is absent; warm activation needs no source IO.
      try { await file.slice(0, 1).arrayBuffer(); }
      catch (cause) { throw new ModelSourceError("unavailable", { cause }); }
      const uploaded = await api.uploadModel(file, progress, signal);
      if (uploaded.modelHash !== hash) throw new ModelSourceError("changed");
      if (signal.aborted) throw new DOMException("Load cancelled", "AbortError");
      response = await prepare();
    }
    const stage = new ModelStage(id, response);
    if (signal.aborted) {
      await stage.rollback();
      throw new DOMException("Load cancelled", "AbortError");
    }
    return stage;
  }
  commit() { return retry(() => api.stageAction(this.id, "commit")); }
  rollback() { return retry(() => api.stageAction(this.id, "rollback")); }
  finalize() { return retry(() => api.stageAction(this.id, "finalize")); }
}
