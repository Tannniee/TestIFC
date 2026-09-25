import type { ActivateModelResponse } from "./api";
import { ModelSourceError } from "./model-source-error";
import { ViewerBridge } from "./viewer-bridge";
import { ModelStage } from "./model-staging";
import type { ViewSessionState } from "./workspace-contracts";
import { LoadCancelledError, type BridgeProgress, type ViewerProgress, type FragmentMetrics } from "./viewer-contracts";
import { requireSupportedIfcSize } from "./model-limits";
import type { ViewerModel } from "./viewer-model-contract";
import type { ModelSource } from "./model-source";
import { loadEngineV2Model } from "./engine-v2/load-artifact";

interface LoaderCallbacks {
  onProgress(progress: ViewerProgress): void;
  onBridgeProgress(progress: BridgeProgress): void;
  onFragmentMetrics(metrics: FragmentMetrics): void;
  attach(model: ViewerModel, assertCurrent: () => void): Promise<void>;
  detach(model: ViewerModel | null): Promise<void>;
  capture(): () => Promise<void>;
  prepareView(state?: ViewSessionState): Promise<void>;
  committed(): void;
  fit(): void;
  update(): Promise<void>;
}
interface ActiveSession {
  source: ModelSource; hash: string; sequence: number; activation: ActivateModelResponse;
  recoveredFaces: number;
}
export interface ModelLoadOptions {
  hash?: string;
  state?: ViewSessionState;
  identified?(hash: string): ViewSessionState | undefined;
}

/** One active model plus one staging operation; newer requests drain older cleanup. */
export class ViewerModelLoader {
  readonly bridge: ViewerBridge;
  private loadSequence = 0;
  private fileRequest = new AbortController();
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();
  private cleanupFailure: Error | null = null;
  private pendingRollback: ModelStage | null = null;
  private pendingDisposals = new Set<ViewerModel>();
  get needsRecovery() { return this.cleanupFailure !== null; }
  private activeSession: ActiveSession | null = null;
  activeModel: ViewerModel | null = null;
  activeModelName = "";
  artifactId = "";
  get identity() { return this.activeSession; }

  constructor(private readonly callbacks: LoaderCallbacks) {
    this.bridge = new ViewerBridge({ onProgress: progress => {
      if (!this.disposed && (progress.loadSequence === this.loadSequence || progress.loadSequence === this.activeSession?.sequence)) {
        callbacks.onBridgeProgress(progress);
      }
    } });
  }

  private abortPending() {
    this.fileRequest.abort();
    this.bridge.cancelFragmentRequests();
  }

  load(source: ModelSource, options: ModelLoadOptions = {}): Promise<void> {
    if (this.disposed) return Promise.reject(new LoadCancelledError());
    const sequence = ++this.loadSequence;
    this.abortPending();
    const controller = new AbortController();
    this.fileRequest = controller;
    const task = this.queue.then(() => this.loadCurrent(source, sequence, controller.signal, options));
    this.queue = task.catch(() => {});
    return task;
  }

  private async loadCurrent(source: ModelSource, sequence: number, signal: AbortSignal, options: ModelLoadOptions): Promise<void> {
    requireSupportedIfcSize(source.size);
    if (this.cleanupFailure) throw this.cleanupFailure;
    const loadStarted = performance.now();
    const previous = this.activeModel;
    const previousSession = this.activeSession;
    const previousName = this.activeModelName;
    const previousArtifact = this.artifactId;
    let stage: ModelStage | null = null;
    let model: ViewerModel | null = null;
    let restore: (() => Promise<void>) | null = null;
    let committed = false;
    const check = () => this.assertCurrent(sequence);
    try {
      check();
      let uploadedHash: string | null = null;
      if (!options.hash && !source.modelHash) {
        if (!source.file) throw new ModelSourceError("unavailable");
        this.callbacks.onBridgeProgress({ loadSequence: sequence, modelHash: null, stage: "uploading", detail: source.name });
        const uploaded = await this.bridge.uploadModel(source.file, progress => this.callbacks.onBridgeProgress({
          loadSequence: sequence, modelHash: null, stage: "uploading", progress, detail: source.name,
        }), signal);
        check();
        if (uploaded.sizeBytes !== source.size) throw new ModelSourceError("changed");
        uploadedHash = uploaded.modelHash;
        source.modelHash = uploadedHash;
      }
      const ifcBytes = source.size;
      const modelHash = options.hash ?? source.modelHash ?? uploadedHash!;
      check();
      const viewState = options.state ?? options.identified?.(modelHash);
      if (options.identified && previousSession?.hash === modelHash) {
        this.activeSession = { ...previousSession, sequence };
        this.watchActive();
        this.publishProgress(sequence, { modelHash, stage: "ready", progress: 1, detail: previousName,
          recoveredFaces: previousSession.recoveredFaces });
        return;
      }
      stage = await ModelStage.prepare(source, modelHash, signal, progress => this.callbacks.onBridgeProgress({
        loadSequence: sequence, modelHash, stage: "uploading", progress, detail: source.name,
      }));
      check();
      const modelId = `${modelHash}-${sequence}`;
      let cacheHit = false;
      let conversionMilliseconds = 0;
      let fragmentLoadMilliseconds = 0;
      let fragmentBytes = 0;
      let recoveredFaces = 0;
      let artifactId = "";
      const profile: FragmentMetrics["profile"] = "engine-v2";
      let attached = false;

      {
        try {
          this.publishProgress(sequence, { modelHash, stage: "converting", detail: source.name, phase: "conversion", category: "Engine V2" });
          const loaded = await loadEngineV2Model(modelId, modelHash, signal, (progress, phase) => {
            this.publishProgress(sequence, { modelHash, stage: "loading", progress, phase: "generating", category: phase, detail: source.name });
          });
          check();
          model = loaded.model;
          cacheHit = loaded.cacheHit;
          conversionMilliseconds = loaded.conversionMilliseconds;
          fragmentLoadMilliseconds = loaded.artifactLoadMilliseconds;
          fragmentBytes = loaded.artifactBytes;
          recoveredFaces = loaded.recoveredDisjointFaces;
          artifactId = `engine-v2:${loaded.artifactKey}`;
          restore = this.callbacks.capture();
          if (previous) previous.frozen = true;
          model.object.visible = false;
          model.frozen = true;
          // attach() mutates the scene before its async elevation alignment.
          // Mark it first so a failure during alignment still detaches the candidate.
          attached = true;
          await this.callbacks.attach(model, check);
          const primeStarted = performance.now();
          await loaded.model.prime(signal);
          fragmentLoadMilliseconds += performance.now() - primeStarted;
          check();
        } catch (error) {
          const failed = model;
          model = null;
          if (failed) {
            if (attached) await this.callbacks.detach(failed);
            await failed.dispose();
          }
          attached = false;
          if (previous) { previous.object.visible = true; previous.frozen = false; }
          await restore?.(); restore = null;
          throw error;
        }
      }

      this.publishProgress(sequence, { modelHash, stage: "finalizing", detail: source.name });
      check();
      this.bridge.stopWatching();
      const activation = await stage.commit("native");
      check();
      this.activeModel = model;
      this.activeModelName = source.name;
      this.artifactId = artifactId;
      if (previous) previous.object.visible = false;
      model.object.visible = true;
      model.frozen = false;
      await this.callbacks.prepareView(viewState); check();
      if (!viewState) this.callbacks.fit();
      await this.callbacks.update();
      check();
      this.activeSession = { source, hash: modelHash, sequence, activation: activation.model, recoveredFaces };
      committed = true;
      this.callbacks.committed();
      this.watchActive();
      this.publishProgress(sequence, { modelHash, stage: "ready", progress: 1, detail: source.name, recoveredFaces });
      this.callbacks.onFragmentMetrics({ loadSequence: sequence, modelHash, profile, engine: model.engine, cacheHit,
        ifcBytes, fragmentBytes, conversionMilliseconds, fragmentLoadMilliseconds, totalMilliseconds: performance.now() - loadStarted });
      try { await stage.finalize(); } catch (error) { console.warn("Model lease finalization will expire automatically", error); }
    } catch (error) {
      if (!committed) {
        let rollbackError: unknown;
        if (stage) {
          try { await stage.rollback(); } catch (failure) { rollbackError = failure; this.pendingRollback = stage; }
          if (!rollbackError) {
            try {
              if (previousSession) await ModelStage.assertActive(previousSession.activation);
            } catch (failure) { rollbackError = failure; this.pendingRollback = stage; }
          }
        }
        this.activeModel = previous;
        this.activeModelName = previousName;
        this.artifactId = previousArtifact;
        this.activeSession = previousSession;
        if (rollbackError) this.bridge.setSelectionWritesEnabled(false);
        try {
          if (model) await this.disposeRetired(model);
        } finally {
          if (previous) { previous.object.visible = true; previous.frozen = false; }
          await restore?.();
        }
        if (rollbackError) {
          this.recordCleanupFailure(new Error(`Không xác nhận được khôi phục INDEX: ${String(rollbackError)}. Bấm Thử lại để khôi phục model đang xem.`));
          throw this.cleanupFailure;
        }
        if (!this.cleanupFailure) this.watchActive();
      }
      if (sequence !== this.loadSequence || this.disposed || signal.aborted) throw new LoadCancelledError();
      throw error;
    } finally {
      if (committed && previous) {
        await this.disposeRetired(previous);
      }
    }
  }

  private async disposeRetired(model: ViewerModel) {
    this.pendingDisposals.add(model);
    model.object.visible = false; model.frozen = true;
    try {
      await this.callbacks.detach(model);
      await model.dispose();
      this.pendingDisposals.delete(model);
    } catch (cause) {
      this.recordCleanupFailure(new Error("Chưa dọn xong model cũ. Bấm Thử lại trước khi chuyển document.", { cause }));
    }
  }
  private recordCleanupFailure(error: Error) {
    this.cleanupFailure = error;
    this.bridge.stopWatching();
    this.bridge.setSelectionWritesEnabled(false);
    const session = this.activeSession;
    if (session) this.callbacks.onBridgeProgress({ loadSequence: session.sequence, modelHash: session.hash,
      stage: "error", detail: error.message, canRetry: true });
  }

  /** Explicit recovery may acquire a fresh backend generation; a stale rollback never may. */
  recover(): Promise<void> {
    const sequence = this.loadSequence;
    const controller = new AbortController(); this.fileRequest = controller;
    const task = this.queue.then(async () => {
      const check = () => this.assertCurrent(sequence);
      check();
      if (this.pendingRollback) {
        const oldStage = this.pendingRollback;
        try {
          await oldStage.rollback(); check();
          await ModelStage.assertActive(this.activeSession?.activation ?? null); check();
        }
        catch (error) {
          check();
          if (!ModelStage.isConflict(error) || !this.activeSession) throw error;
          const session = this.activeSession;
          const recovery = await ModelStage.prepare(session.source, session.hash, controller.signal, () => {});
          try {
            check(); const committed = await recovery.commit(session.activation.semanticMode); check();
            this.activeSession = { ...session, activation: committed.model };
          } catch (failure) { await recovery.rollback(); throw failure; }
          // Finalize only releases leases; it cannot replace another generation.
          await recovery.finalize().catch(error => console.warn("Recovery lease will expire", error));
          await oldStage.finalize().catch(error => console.warn("Old lease will expire", error));
        }
        this.pendingRollback = null;
      }
      for (const model of [...this.pendingDisposals]) { check(); await this.disposeRetired(model); }
      check();
      if (this.pendingDisposals.size) throw this.cleanupFailure;
      this.cleanupFailure = null;
      this.bridge.setSelectionWritesEnabled(true);
      this.watchActive();
    }).catch(error => {
      if (!(error instanceof LoadCancelledError)) this.recordCleanupFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  private watchActive() {
    const session = this.activeSession;
    if (!session || this.disposed) return;
    void this.bridge.watchModel(session.source, session.hash, session.sequence, session.activation);
  }

  async cancelLoad() {
    ++this.loadSequence;
    this.abortPending();
    await this.queue;
    // With no local model there is nothing to restore. Retrying Open can release
    // an abandoned ticket without replacing the backend generation that owns it.
    if (this.cleanupFailure && !this.activeSession) {
      if (this.pendingRollback) {
        try { await this.pendingRollback.rollback(); }
        catch (error) {
          if (!ModelStage.isConflict(error)) throw error;
          await this.pendingRollback.finalize().catch(error => console.warn("Abandoned lease will expire", error));
        }
        this.pendingRollback = null;
      }
      for (const model of [...this.pendingDisposals]) await this.disposeRetired(model);
      if (!this.pendingDisposals.size) { this.cleanupFailure = null; this.bridge.setSelectionWritesEnabled(true); }
    }
    if (this.cleanupFailure) throw this.cleanupFailure;
  }
  async closeModel() {
    await this.cancelLoad();
    const model = this.activeModel, session = this.activeSession;
    if (session) await this.bridge.closeActiveModel(session.activation);
    this.bridge.stopWatching();
    if (model) {
      await this.callbacks.detach(model);
      await model.dispose();
    }
    this.activeModel = null; this.activeSession = null; this.activeModelName = ""; this.artifactId = "";
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { await this.cancelLoad(); }
    finally {
      try { await this.bridge.cancelModelRequests(); }
      finally {
        const active = this.activeModel;
        await this.callbacks.detach(active);
        this.activeModel = null;
        this.activeSession = null;
        await active?.dispose();
      }
    }
  }
  private assertCurrent(sequence: number) {
    if (sequence !== this.loadSequence || this.disposed) throw new LoadCancelledError();
  }
  private publishProgress(sequence: number, progress: Omit<ViewerProgress, "loadSequence">) {
    if (sequence === this.loadSequence && !this.disposed) this.callbacks.onProgress({ ...progress, loadSequence: sequence });
  }
}
