export interface ViewerLifecycleSnapshot {
  created: number;
  disposed: number;
  active: number;
}

let created = 0;
let disposed = 0;

export function markViewerCreated() {
  created += 1;
}

export function markViewerDisposed() {
  disposed += 1;
}

export function viewerLifecycleSnapshot(): ViewerLifecycleSnapshot {
  return { created, disposed, active: created - disposed };
}

export function resetViewerLifecycleDiagnostics() {
  created = 0;
  disposed = 0;
}
