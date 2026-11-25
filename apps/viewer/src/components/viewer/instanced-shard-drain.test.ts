/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drainInstancedShards } from './instanced-shard-drain';

test('large shard delivery yields, cancellation preserves already uploaded occurrences, resume delivers the rest once', () => {
  const uploaded = new Set<number>(), calls: number[] = [];
  let clock = 0, complete = 0, renders = 0;
  const pending: { tick?: () => void } = {};
  const options = {
    entries: [1, 2, 3, 4, 5], isDone: (id: number) => uploaded.has(id),
    upload: (id: number) => { calls.push(id); uploaded.add(id); clock += 5; },
    now: () => clock, schedule: (tick: () => void) => { pending.tick = tick; return 1; },
    unschedule: () => { pending.tick = undefined; },
    requestRender: () => { renders++; }, complete: () => { complete++; },
  };
  const cancel = drainInstancedShards(options);
  assert.deepEqual(calls, [1, 2], 'do not synchronously upload every shard');
  assert.equal(complete, 0); assert.equal(renders, 1);
  const queuedTick = () => pending.tick;
  cancel(); assert.equal(queuedTick(), undefined);
  drainInstancedShards(options);
  assert.deepEqual(calls, [1, 2, 3, 4]);
  const tick = queuedTick(); assert.ok(tick); tick();
  assert.deepEqual(calls, [1, 2, 3, 4, 5]); assert.equal(complete, 1);
});
