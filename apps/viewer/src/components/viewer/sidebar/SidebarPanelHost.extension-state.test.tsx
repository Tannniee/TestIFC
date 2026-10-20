/* SPDX-License-Identifier: MPL-2.0 */
import '@/test/setup-dom.js';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, useState } from 'react';
import { render, click, cleanup } from '@/test/render';
import { registerAnalysisExtensions, openAnalysisExtension, closeActiveAnalysisExtension } from '@/services/analysis-extensions';
import { SidebarPanelHost } from './SidebarPanelHost';

it('switching analysis extensions starts the new extension with its own local state (app quality audit)', () => {
  function Counter({ label }: { label: string }) {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(value => value + 1)}>{label}:{count}</button>;
  }
  const unregister = registerAnalysisExtensions(['audit-a', 'audit-b'].map(id => ({
    id, label: id, icon: () => null, renderPanel: () => <Counter label={id} />,
  })));
  try {
    act(() => { openAnalysisExtension('audit-a'); });
    const ui = render(<SidebarPanelHost />);
    const first = ui.querySelector('button'); assert.ok(first); click(first);
    assert.equal(ui.textContent, 'audit-a:1');
    act(() => { openAnalysisExtension('audit-b'); });
    assert.equal(ui.textContent, 'audit-b:0', 'the prior extension must not lend its state to the next one');
  } finally { cleanup(); closeActiveAnalysisExtension(); unregister(); }
});
