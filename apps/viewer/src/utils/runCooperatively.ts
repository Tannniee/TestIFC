/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Drain the same canonical operation synchronously or in bounded UI turns. */
export function finishSteps<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export interface CooperativeOptions {
  budgetMs?: number;
  now?: () => number;
  yieldControl?: () => Promise<void>;
  signal?: AbortSignal;
}

function yieldBackgroundTask(): Promise<void> {
  const host = globalThis as typeof globalThis & {
    scheduler?: { postTask(callback: () => void, options: { priority: 'background' }): Promise<void> };
  };
  return typeof host.scheduler?.postTask === 'function'
    ? host.scheduler.postTask(() => undefined, { priority: 'background' })
    : new Promise(resolve => setTimeout(resolve, 0));
}

export async function runCooperatively<T>(steps: Generator<void, T>, options: CooperativeOptions = {}): Promise<T> {
  const now = options.now ?? (() => performance.now());
  const yieldControl = options.yieldControl ?? yieldBackgroundTask;
  const budget = options.budgetMs ?? 8;
  let start = now();
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const step = steps.next();
      if (step.done) return step.value;
      if (now() - start >= budget) {
        await yieldControl();
        options.signal?.throwIfAborted();
        start = now();
      }
    }
  } finally {
    steps.return(undefined as never);
  }
}
