/** One frame per invalidation; animation/damping explicitly request continuation. */
export class RenderScheduler {
  private frame: number | null = null;
  private disposed = false;
  frames = 0;
  constructor(
    private readonly draw: (time: number) => boolean,
    private readonly request: (callback: FrameRequestCallback) => number = (callback) => requestAnimationFrame(callback),
    private readonly cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}
  readonly invalidate = () => {
    if (!this.disposed && this.frame === null) this.frame = this.request(this.tick);
  };
  private readonly tick = (time: number) => {
    this.frame = null;
    if (this.disposed) return;
    this.frames++;
    if (this.draw(time)) this.invalidate();
  };
  dispose() {
    this.disposed = true;
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
  }
}

/** Serialize worker view updates and retain the latest forced refresh. */
export class FragmentUpdates {
  private pending = false;
  private force = false;
  private running: Promise<void> | null = null;
  private disposed = false;
  private lastDispatch = -Infinity;
  private wake: (() => void) | null = null;
  constructor(private readonly update: (force: boolean) => Promise<void>, private readonly intervalMs = 0) {}
  request(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.pending = true;
    this.force ||= force;
    if (force) this.wake?.();
    if (!this.running) this.running = this.drain().finally(() => {
      this.running = null;
      if (this.pending && !this.disposed) return this.request();
    });
    return this.running;
  }
  private async drain() {
    while (this.pending && !this.disposed) {
      const delay = this.intervalMs - (performance.now() - this.lastDispatch);
      if (!this.force && delay > 0) await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.wake = null; resolve(); }, delay);
        this.wake = () => { clearTimeout(timer); this.wake = null; resolve(); };
      });
      if (this.disposed) break;
      const force = this.force;
      this.pending = this.force = false;
      this.lastDispatch = performance.now();
      await this.update(force);
    }
  }
  async dispose() {
    this.disposed = true;
    this.pending = false;
    this.wake?.();
    await this.running;
  }
}

/** Adjust navigation resolution from rendered frame intervals, never from idle RAF time. */
export class NavigationPixelRatio {
  private readonly minimum: number;
  private value: number;
  private previousFrame: number | null = null;
  private slowFrames = 0;
  private fastFrames = 0;
  private lastChange = -Infinity;

  constructor(private readonly display: number) {
    this.minimum = Math.min(display, 0.75);
    this.value = display;
  }

  begin(heavyScene: boolean): number {
    this.previousFrame = null;
    this.slowFrames = this.fastFrames = 0;
    this.lastChange = -Infinity;
    this.value = heavyScene ? this.minimum : this.display;
    return this.value;
  }

  sample(frameAt: number): number {
    const interval = this.previousFrame === null ? 0 : frameAt - this.previousFrame;
    this.previousFrame = frameAt;
    if (interval <= 0 || interval > 250) {
      this.slowFrames = this.fastFrames = 0;
      return this.value;
    }
    this.slowFrames = interval > 22 ? this.slowFrames + 1 : 0;
    this.fastFrames = interval < 14 ? this.fastFrames + 1 : 0;
    if (this.slowFrames >= 5 && frameAt - this.lastChange >= 250) {
      this.value = Math.max(this.minimum, this.value - 0.25);
      this.slowFrames = 0;
      this.lastChange = frameAt;
    } else if (this.fastFrames >= 20 && frameAt - this.lastChange >= 500) {
      this.value = Math.min(this.display, this.value + 0.25);
      this.fastFrames = 0;
      this.lastChange = frameAt;
    }
    return this.value;
  }

  end(): number {
    this.previousFrame = null;
    this.value = this.display;
    return this.value;
  }
}
