/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
export function finishBatchSteps<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export interface BatchScheduling {
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

/** Check cancellation at every CPU/GPU checkpoint, even below the time budget.
 * Closing the generator runs its ownership cleanup when a batch is aborted. */
export async function sliceBatchSteps<T>(steps: Generator<void, T>, options: BatchScheduling = {}): Promise<T> {
  const now = options.now ?? (() => performance.now());
  const yieldControl = options.yieldControl ?? yieldBackgroundTask;
  let start = now();
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const step = steps.next();
      options.signal?.throwIfAborted();
      if (step.done) return step.value;
      if (now() - start >= (options.budgetMs ?? 8)) {
        await yieldControl();
        options.signal?.throwIfAborted();
        start = now();
      }
    }
  } finally {
    steps.return(undefined as never);
  }
}
