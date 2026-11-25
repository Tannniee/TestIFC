/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

interface RestoreRequest<T> {
  current(): boolean;
  build(signal: AbortSignal): Promise<T>;
  publish(value: T): void;
  discard(value: T): void;
}

type Outcome<T> = { value: T } | { error: unknown };
interface RestoreJob<T> {
  request: RestoreRequest<T>;
  controller: AbortController;
  outcome?: Outcome<T>;
}

/** One bounded asynchronous preparation at a time. The animation loop polls
 * complete work; only that poll can publish into the current scene. */
export class ResidencyRestore<T> {
  private active: RestoreJob<T> | undefined;

  hasPending(): boolean { return this.active !== undefined; }

  start(request: RestoreRequest<T>): void {
    if (this.active) throw new Error('A GPU residency restore is already preparing.');
    const job: RestoreJob<T> = { request, controller: new AbortController() };
    this.active = job;
    // Defer even the first preparation slice beyond the animation callback.
    void Promise.resolve().then(() => {
      job.controller.signal.throwIfAborted();
      return request.build(job.controller.signal);
    }).then(value => {
      if (this.active !== job || job.controller.signal.aborted) request.discard(value);
      else job.outcome = { value };
    }).catch(error => {
      if (this.active === job) job.outcome = { error };
      else if (!job.controller.signal.aborted) console.warn('[Scene] retired GPU restore failed:', error);
    });
  }

  poll(): number {
    const job = this.active;
    if (!job) return 0;
    if (!job.request.current()) { this.clear(); return 0; }
    const outcome = job.outcome;
    if (!outcome) return 0;
    this.active = undefined;
    if ('error' in outcome) throw outcome.error;
    try { job.request.publish(outcome.value); }
    catch (error) { job.request.discard(outcome.value); throw error; }
    return 1;
  }

  clear(): void {
    const job = this.active;
    if (!job) return;
    this.active = undefined;
    job.controller.abort();
    if (job.outcome && 'value' in job.outcome) job.request.discard(job.outcome.value);
  }
}
