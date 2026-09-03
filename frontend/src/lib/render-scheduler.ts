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
  constructor(private readonly update: (force: boolean) => Promise<void>) {}
  request(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.pending = true;
    this.force ||= force;
    if (!this.running) this.running = this.drain().finally(() => {
      this.running = null;
      if (this.pending && !this.disposed) return this.request();
    });
    return this.running;
  }
  private async drain() {
    while (this.pending && !this.disposed) {
      const force = this.force;
      this.pending = this.force = false;
      await this.update(force);
    }
  }
  async dispose() {
    this.disposed = true;
    this.pending = false;
    await this.running;
  }
}
