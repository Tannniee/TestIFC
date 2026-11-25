// SPDX-License-Identifier: MPL-2.0
import '@/test/setup-dom.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleFastPath, scheduleWasmPrewarm } from './wasm-prewarm';
import { startFastPath } from './fast-path/startFastPath';

// Brief 01: the native path must never arm speculative WASM/worker work.
it('brief-01 native startup neither schedules browser warmup nor starts its runtime', t => {
  let scheduled = 0;
  const previousNative = Object.getOwnPropertyDescriptor(globalThis, '__IFCLITE_NATIVE__');
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const previousIdle = Object.getOwnPropertyDescriptor(window, 'requestIdleCallback');
  Object.defineProperty(globalThis, '__IFCLITE_NATIVE__', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class { constructor() { throw new Error('Native startup spawned a worker'); } } });
  t.mock.method(window, 'setTimeout', () => { scheduled++; return 0; });
  t.mock.method(WebAssembly, 'compile', () => { throw new Error('Native startup compiled WASM'); });
  t.mock.method(WebAssembly, 'instantiate', () => { throw new Error('Native startup instantiated WASM'); });
  // happy-dom has no idle callback; install the browser capability explicitly.
  Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: () => { scheduled++; return 0; } });
  try {
    scheduleWasmPrewarm();
    scheduleFastPath();
    assert.equal(startFastPath(), false);
    assert.equal(scheduled, 0);
  } finally {
    if (previousIdle) Object.defineProperty(window, 'requestIdleCallback', previousIdle);
    else Reflect.deleteProperty(window, 'requestIdleCallback');
    if (previousNative) Object.defineProperty(globalThis, '__IFCLITE_NATIVE__', previousNative);
    else Reflect.deleteProperty(globalThis, '__IFCLITE_NATIVE__');
    if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});
