import { FragmentsModels, type FragmentsModel } from "@thatopen/fragments";
import type * as THREE from "three";
import type { ActivateModelResponse } from "./api";
import { IfcConverter, sha256Hex } from "./ifc-converter";
import { fragmentArrayBuffer } from "./fragment-buffer";
import { readModelFile } from "./read-model-file";
import { ModelSourceError } from "./model-source-error";
import { fragmentCacheKey, type FragmentMetadataProfile } from "./fragment-profile";
import { ViewerBridge } from "./viewer-bridge";
import { ModelStage } from "./model-staging";
import type { ViewSessionState } from "./workspace-contracts";
import { LoadCancelledError, type BridgeProgress, type ViewerProgress, type FragmentMetrics } from "./viewer-contracts";

interface LoaderCallbacks {
  onProgress(progress: ViewerProgress): void;
  onBridgeProgress(progress: BridgeProgress): void;
  onFragmentMetrics(metrics: FragmentMetrics): void;
  attach(model: FragmentsModel, assertCurrent: () => void): Promise<void>;
  detach(model: FragmentsModel | null): Promise<void>;
  capture(): () => Promise<void>;
  prepareView(state?: ViewSessionState): Promise<void>;
  committed(): void;
  fit(): void;
  update(): Promise<void>;
}
interface ActiveSession {
  file: File; hash: string; sequence: number; activation: ActivateModelResponse;
}
export interface ModelLoadOptions {
  hash?: string;
  state?: ViewSessionState;
  identified?(hash: string): ViewSessionState | undefined;
}

/** One active model plus one staging operation; newer requests drain older cleanup. */
export class ViewerModelLoader {
  readonly fragments = new FragmentsModels("/vendor/fragments/worker.mjs", { maxWorkers: 2 });
  readonly bridge: ViewerBridge;
  private readonly converter: IfcConverter;
  private loadSequence = 0;
  private fileRequest = new AbortController();
  private loadingModelId: string | null = null;
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();
  private cleanupFailure: Error | null = null;
  private pendingRollback: ModelStage | null = null;
  private pendingDisposals = new Set<FragmentsModel>();
  get needsRecovery() { return this.cleanupFailure !== null; }
  private activeSession: ActiveSession | null = null;
  activeModel: FragmentsModel | null = null;
  activeModelName = "";
  artifactId = "";
  get identity() { return this.activeSession; }

  constructor(private readonly camera: THREE.OrthographicCamera, private readonly fragmentProfile: FragmentMetadataProfile,
    private readonly callbacks: LoaderCallbacks) {
    this.converter = new IfcConverter(fragmentProfile);
    // A and B are alternative documents, not federated models sharing A's origin.
    this.fragments.settings.autoCoordinate = false;
    this.bridge = new ViewerBridge({ onProgress: progress => {
      if (!this.disposed && (progress.loadSequence === this.loadSequence || progress.loadSequence === this.activeSession?.sequence)) {
        callbacks.onBridgeProgress(progress);
      }
    } });
  }

  private abortPending() {
    this.fileRequest.abort();
    this.converter.cancel();
    this.bridge.cancelFragmentRequests();
    if (this.loadingModelId) this.fragments.abort(this.loadingModelId);
  }

  load(file: File, options: ModelLoadOptions = {}): Promise<void> {
    if (this.disposed) return Promise.reject(new LoadCancelledError());
    const sequence = ++this.loadSequence;
    this.abortPending();
    const controller = new AbortController();
    this.fileRequest = controller;
    const task = this.queue.then(() => this.loadCurrent(file, sequence, controller.signal, options));
    this.queue = task.catch(() => {});
    return task;
  }

  private async loadCurrent(file: File, sequence: number, signal: AbortSignal, options: ModelLoadOptions): Promise<void> {
    if (this.cleanupFailure) throw this.cleanupFailure;
    const loadStarted = performance.now();
    const previous = this.activeModel;
    const previousSession = this.activeSession;
    const previousName = this.activeModelName;
    const previousArtifact = this.artifactId;
    let stage: ModelStage | null = null;
    let model: FragmentsModel | null = null;
    let restore: (() => Promise<void>) | null = null;
    let committed = false;
    const check = () => this.assertCurrent(sequence);
    try {
      check();
      this.publishProgress(sequence, { modelHash: null, stage: "reading", detail: file.name });
      let ifcBuffer = options.hash ? null : await readModelFile(file, signal, progress =>
        this.publishProgress(sequence, { modelHash: null, stage: "reading", progress, detail: file.name }));
      check();
      const ifcBytes = file.size;
      if (!options.hash) this.publishProgress(sequence, { modelHash: null, stage: "hashing", detail: file.name });
      const modelHash = options.hash ?? await sha256Hex(ifcBuffer!);
      check();
      const viewState = options.state ?? options.identified?.(modelHash);
      if (options.identified && previousSession?.hash === modelHash) {
        this.activeSession = { ...previousSession, sequence };
        this.watchActive();
        this.publishProgress(sequence, { modelHash, stage: "ready", progress: 1, detail: previousName });
        return;
      }
      stage = await ModelStage.prepare(file, modelHash, signal, progress => this.callbacks.onBridgeProgress({
        loadSequence: sequence, modelHash, stage: "uploading", progress, detail: file.name,
      }));
      check();
      this.publishProgress(sequence, { modelHash, stage: "cache", detail: file.name });
      const cacheKey = fragmentCacheKey(modelHash, this.fragmentProfile);
      let fragmentBuffer = await this.bridge.fragments(cacheKey);
      const cacheHit = fragmentBuffer !== null;
      let conversionMilliseconds = 0;
      check();
      if (!fragmentBuffer) {
        if (!ifcBuffer) {
          ifcBuffer = await readModelFile(file, signal, () => {}); check();
          if (await sha256Hex(ifcBuffer) !== modelHash) throw new ModelSourceError("changed");
          check();
        }
        this.publishProgress(sequence, { modelHash, stage: "converting", progress: 0, detail: file.name });
        const started = performance.now();
        const converted = await this.converter.convert(ifcBuffer, (progress, data) => {
          this.publishProgress(sequence, { modelHash, stage: "converting", progress, detail: file.name,
            phase: data?.process, entitiesProcessed: data?.entitiesProcessed, category: data?.class });
        });
        conversionMilliseconds = performance.now() - started;
        check();
        fragmentBuffer = fragmentArrayBuffer(converted);
        this.bridge.cacheFragments(cacheKey, converted, () => sequence === this.loadSequence && !this.disposed);
      }
      const fragmentBytes = fragmentBuffer.byteLength;
      const artifactId = `${cacheKey}:${await sha256Hex(fragmentBuffer)}`;
      check();
      this.publishProgress(sequence, { modelHash, stage: "loading", progress: 0, detail: file.name });
      restore = this.callbacks.capture();
      if (previous) previous.frozen = true;
      const modelId = `${modelHash}-${sequence}`;
      this.loadingModelId = modelId;
      const started = performance.now();
      try {
        model = await this.fragments.load(fragmentBuffer, { modelId, camera: this.camera,
          onProgress: ({ progress, stage: phase }) => this.publishProgress(sequence, { modelHash, stage: "loading", progress, phase, detail: file.name }) });
      } finally { this.loadingModelId = null; }
      const fragmentLoadMilliseconds = performance.now() - started;
      check();
      model.object.visible = false;
      model.frozen = true;
      this.publishProgress(sequence, { modelHash, stage: "finalizing", detail: file.name });
      await this.callbacks.attach(model, check);
      check();
      this.bridge.stopWatching();
      const activation = await stage.commit();
      check();
      this.activeModel = model;
      this.activeModelName = file.name;
      this.artifactId = artifactId;
      if (previous) previous.object.visible = false;
      model.object.visible = true;
      model.frozen = false;
      await this.callbacks.prepareView(viewState); check();
      if (!viewState) this.callbacks.fit();
      await this.callbacks.update();
      check();
      this.activeSession = { file, hash: modelHash, sequence, activation: activation.model };
      committed = true;
      this.callbacks.committed();
      this.watchActive();
      this.publishProgress(sequence, { modelHash, stage: "ready", progress: 1, detail: file.name });
      this.callbacks.onFragmentMetrics({ loadSequence: sequence, modelHash, profile: this.fragmentProfile, cacheHit,
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

  private async disposeRetired(model: FragmentsModel) {
    this.pendingDisposals.add(model);
    model.object.visible = false; model.frozen = true;
    try {
      await this.callbacks.detach(model);
      await this.fragments.disposeModel(model.modelId);
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
          const recovery = await ModelStage.prepare(session.file, session.hash, controller.signal, () => {});
          try {
            check(); const committed = await recovery.commit(); check();
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
    void this.bridge.watchModel(session.file, session.hash, session.sequence, session.activation);
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
    if (model) { await this.callbacks.detach(model); await this.fragments.disposeModel(model.modelId); }
    this.activeModel = null; this.activeSession = null; this.activeModelName = ""; this.artifactId = "";
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { await this.cancelLoad(); }
    finally {
      this.converter.dispose();
      try { await this.bridge.cancelModelRequests(); }
      finally {
        await this.callbacks.detach(this.activeModel);
        this.activeModel = null;
        this.activeSession = null;
        await this.fragments.dispose();
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
