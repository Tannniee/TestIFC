/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Yield between shard uploads. Completed bytes are recorded by the caller so
 * an effect restart cannot duplicate GPU occurrences already installed. */
export function drainInstancedShards<T>(options: {
  entries: readonly T[];
  isDone: (entry: T) => boolean;
  upload: (entry: T) => void;
  complete: () => void;
  requestRender: () => void;
  now?: () => number;
  schedule?: (tick: () => void) => number;
  unschedule?: (id: number) => void;
}): () => void {
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? (tick => requestAnimationFrame(tick));
  const unschedule = options.unschedule ?? (id => cancelAnimationFrame(id));
  let index = 0, frame: number | undefined, cancelled = false;
  const tick = () => {
    frame = undefined;
    const start = now();
    while (!cancelled && index < options.entries.length) {
      const entry = options.entries[index++];
      if (!options.isDone(entry)) options.upload(entry);
      if (now() - start >= 8) break;
    }
    if (cancelled) return;
    options.requestRender();
    if (index < options.entries.length) frame = schedule(tick);
    else options.complete();
  };
  tick();
  return () => { cancelled = true; if (frame !== undefined) unschedule(frame); };
}
