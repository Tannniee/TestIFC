import { activeDocument, activeView, emptyWorkspace, type DocumentSession, type ViewSessionState, type WorkspaceState } from "./workspace-contracts";
import { emptyModelReadiness } from "./model-readiness";
import type { ViewerService } from "./viewer";
import { LoadCancelledError, type ViewerProgress, type BridgeProgress } from "./viewer-contracts";
import { ModelSourceError } from "./model-source-error";

/** Session ownership lives here; the viewer owns only the active rendering resources. */
export class WorkspaceManager {
  private state = emptyWorkspace();
  private sources = new Map<string, File>();
  private listeners = new Set<(state: WorkspaceState) => void>();
  private queue: Promise<void> = Promise.resolve();
  private revision = 0;
  private disposed = false;
  constructor(private readonly viewer: ViewerService) {}
  subscribe(listener: (state: WorkspaceState) => void) { this.listeners.add(listener); listener(structuredClone(this.state)); return () => { this.listeners.delete(listener); }; }
  private emit() { const snapshot = structuredClone(this.state); for (const listener of this.listeners) listener(snapshot); }
  snapshot() { return structuredClone(this.state); }
  saveActive() {
    const doc = activeDocument(this.state), view = activeView(this.state);
    if (doc && view && this.viewer.modelHash === doc.modelHash && !this.viewer.sectionBoxCreationActive) view.state = this.viewer.captureViewState();
  }
  changed() { if (!this.state.busy && !this.viewer.sectionBoxCreationActive) { this.saveActive(); this.emit(); } }
  geometry(progress: ViewerProgress) {
    const doc = this.state.documents.find(d => d.modelHash === progress.modelHash);
    if (doc) doc.readiness = { ...doc.readiness, modelHash: doc.modelHash, fileName: doc.filename, loadSequence: progress.loadSequence, geometry: progress };
    this.emit();
  }
  semantic(progress: BridgeProgress) {
    const doc = this.state.documents.find(d => d.modelHash === progress.modelHash);
    if (doc && doc.readiness.loadSequence === progress.loadSequence) { doc.readiness.semantic = progress; this.emit(); }
  }
  private run(action: (check: () => void) => Promise<void>, recovering = false): Promise<void> {
    const revision = ++this.revision;
    // Attach rejection handlers immediately while the previous operation drains.
    const cleanup = Promise.allSettled([recovering ? Promise.resolve() : this.viewer.cancelLoad(), this.viewer.cancelTransientInteraction()]);
    const check = () => { if (revision !== this.revision || this.disposed) throw new LoadCancelledError(); };
    const task = this.queue.then(async () => {
      try {
        const results = await cleanup; check();
        for (const result of results) if (result.status === "rejected") throw result.reason;
        this.saveActive(); this.state.busy = true; this.state.error = null; this.viewer.setInputBlocked(true); this.emit();
        await action(check);
      }
      catch (error) {
        if (revision === this.revision && !(error instanceof LoadCancelledError)) {
          const message = error instanceof Error ? error.message : String(error);
          this.state.error = message;
          const requested = this.state.documents.find(d => d.id === this.state.requestedDocumentId);
          if (requested) {
            requested.error = message;
            if (error instanceof ModelSourceError) requested.sourceIssue = error.reason;
          }
        }
        throw error;
      } finally {
        this.viewer.setInputBlocked(false);
        if (revision === this.revision) { this.state.busy = false; this.state.requestedDocumentId = null; this.emit(); }
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  openDocument(file: File) {
    return this.run(async check => {
      await this.viewer.load(file, { identified: hash => {
        check();
        let doc = this.state.documents.find(d => d.modelHash === hash);
        if (!doc) {
          doc = { id: hash, modelHash: hash, filename: file.name, activeViewId: "", views: [],
            readiness: emptyModelReadiness(), expandedNodes: [], error: null };
          this.state.documents.push(doc);
        }
        this.sources.set(doc.id, file);
        this.state.requestedDocumentId = doc.id; doc.error = null; doc.sourceIssue = null; this.emit();
        return doc.views.find(v => v.id === doc.activeViewId)?.state;
      } });
      this.adoptLoaded(); check();
    });
  }
  private adoptLoaded() {
    const doc = this.state.documents.find(d => d.modelHash === this.viewer.modelHash);
    if (!doc) throw new Error("Loaded IFC has no document session");
    if (!doc.views.length) {
      const id = crypto.randomUUID(); doc.activeViewId = id;
      doc.views.push({ id, name: "3D View", type: "default3d", state: this.viewer.captureViewState() });
    }
    this.state.activeDocumentId = doc.id; doc.error = null; doc.sourceIssue = null;
    this.emit();
  }
  private async loadDocument(doc: DocumentSession) {
    this.state.requestedDocumentId = doc.id; doc.error = null; this.emit();
    const file = this.sources.get(doc.id);
    if (!file) throw new ModelSourceError("unavailable");
    await this.viewer.load(file, { hash: doc.modelHash, state: doc.views.find(v => v.id === doc.activeViewId)?.state });
    this.adoptLoaded();
  }
  activateDocument(id: string) {
    return this.run(async check => {
      const doc = this.state.documents.find(d => d.id === id);
      if (!doc) return;
      if (id !== this.state.activeDocumentId || this.viewer.modelHash !== doc.modelHash) await this.loadDocument(doc);
      check();
    });
  }
  private async switchView(id: string, check: () => void) {
    const doc = activeDocument(this.state), previous = activeView(this.state);
    const target = doc?.views.find(v => v.id === id);
    if (!doc || !target || target === previous) return;
    try { await this.viewer.applyViewState(target.state); check(); doc.activeViewId = id; }
    catch (error) { if (previous) await this.viewer.applyViewState(previous.state); throw error; }
  }
  activateView(id: string) { return this.run(check => this.switchView(id, check)); }
  retrySemantic() {
    return this.viewer.needsModelRecovery
      ? this.run(check => this.viewer.recoverModel(check), true)
      : this.viewer.retrySemantic();
  }
  async beginSectionBox(redraw = false) {
    if (this.state.busy) return;
    await this.viewer.cancelTransientInteraction(); this.saveActive();
    await this.viewer.beginSectionBox(!redraw);
  }
  sectionBoxCreated(state: ViewSessionState) {
    const doc = activeDocument(this.state);
    if (!doc || doc.modelHash !== this.viewer.modelHash) return;
    let n = 1; while (doc.views.some(v => v.name === `Section Box ${n}`)) n++;
    const id = crypto.randomUUID();
    doc.views.push({ id, name: `Section Box ${n}`, type: "sectionBox", state: structuredClone(state) });
    doc.activeViewId = id; this.emit();
  }
  closeView(id: string) {
    return this.run(async check => {
      const doc = activeDocument(this.state), view = doc?.views.find(v => v.id === id);
      if (!doc || !view || view.type === "default3d") return;
      const index = doc.views.indexOf(view);
      if (doc.activeViewId === id) await this.switchView((doc.views[index+1] ?? doc.views[index-1]).id, check);
      check(); doc.views = doc.views.filter(v => v.id !== id);
    });
  }
  closeDocument(id: string) {
    return this.run(async check => {
      const doc = this.state.documents.find(d => d.id === id);
      if (!doc) return;
      if (id === this.state.activeDocumentId) {
        const index = this.state.documents.indexOf(doc);
        const next = this.state.documents[index+1] ?? this.state.documents[index-1];
        if (next) await this.loadDocument(next);
        else { await this.viewer.closeModel(); this.state.activeDocumentId = null; }
      }
      check(); this.sources.delete(id); this.state.documents = this.state.documents.filter(d => d.id !== id);
    });
  }
  async cancel() {
    ++this.revision;
    try {
      const results = await Promise.allSettled([this.viewer.cancelTransientInteraction(), this.viewer.cancelLoad(), this.queue]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    } finally { this.state.busy = false; this.state.requestedDocumentId = null; this.viewer.setInputBlocked(false); this.emit(); }
  }
  setExpandedNodes(ids: string[]) { const doc = activeDocument(this.state); if (doc) { doc.expandedNodes = [...ids]; this.emit(); } }
  async dispose() {
    this.disposed = true;
    try { await this.cancel(); }
    finally { this.sources.clear(); this.listeners.clear(); this.state = emptyWorkspace(); }
  }
}
