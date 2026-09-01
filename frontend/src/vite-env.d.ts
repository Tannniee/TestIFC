/// <reference types="vite/client" />

interface Window {
  __ifcViewerLifecycle?: {
    remount(): Promise<void>;
    snapshot(): {
      created: number;
      disposed: number;
      active: number;
      canvasCount: number;
    };
  };
}
