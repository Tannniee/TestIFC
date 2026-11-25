/* SPDX-License-Identifier: MPL-2.0 */
import '@/test/setup-dom.js';
import { installLayout } from '@/test/dom-layout.js';
installLayout();
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { act, useEffect, useState } from 'react';
import { cleanup, render, click } from '@/test/render';
import { DrawingWorkspaceSplit } from './DrawingWorkspaceSplit';
afterEach(cleanup);

it('preserves one live viewport when Drawing docks beside or below it (app quality audit)', async () => {
  let mounts = 0, unmounts = 0;
  function Viewport() {
    useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return <canvas data-live-viewport />;
  }
  function Harness() {
    const [beside, setBeside] = useState(false);
    return <><button onClick={() => setBeside(value => !value)}>Move Drawing</button>
      <DrawingWorkspaceSplit beside={beside} drawing={<p>Drawing</p>}><Viewport /></DrawingWorkspaceSplit></>;
  }
  const ui = render(<Harness />), canvas = ui.querySelector('canvas'), toggle = ui.querySelector('button');
  assert.ok(canvas && toggle);
  for (let n = 0; n < 4; n++) {
    click(toggle);
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    assert.equal(ui.querySelector('canvas'), canvas);
    assert.equal(canvas.isConnected, true); assert.equal(mounts, 1); assert.equal(unmounts, 0);
  }
  cleanup(); assert.equal(unmounts, 1);
});
