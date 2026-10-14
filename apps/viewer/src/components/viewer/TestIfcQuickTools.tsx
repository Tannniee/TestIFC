/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { Hand, MousePointer2, Scan, Ruler } from 'lucide-react';
import { useViewerStore } from '@/store';
import { useTranslation, type TranslationKey } from '@/i18n';
import './test-ifc-tools.css';

export function TestIfcQuickTools() {
  const { t } = useTranslation();
  const tool = useViewerStore(s => s.activeTool);
  const mode = useViewerStore(s => s.testIfcOrbitMode);
  const ready = useViewerStore(s => s.models.size > 0 || !!s.geometryResult);
  const measureMode = useViewerStore(s => s.measureMode);
  const boxOpen = useViewerStore(s => s.activeTool === 'section' && !!s.sectionPlane.box);
  const items = [
    { mode: 'model', key: 'testIfc.pan', Icon: Hand },
    { mode: 'selection', key: 'testIfc.selectOrbit', Icon: MousePointer2 },
    { mode: 'multi', key: 'testIfc.multi', Icon: Scan },
    { mode: 'measure', key: 'testIfc.measure', Icon: Ruler },
  ] as const;
  const activate = (next: typeof items[number]['mode']) => {
    const s = useViewerStore.getState();
    if (s.navigationPreset !== 'testifc') s.setProjectionMode('orthographic');
    s.setNavigationPreset('testifc');
    if (next === 'measure') {
      s.setActiveTool('measure'); s.setMeasureMode('drag');
    } else {
      s.setTestIfcOrbitMode(next); s.setActiveTool('select');
    }
  };
  const hint: TranslationKey | null = tool === 'select' && mode === 'selection' ? 'testIfc.selectHint'
    : tool === 'select' && mode === 'multi' ? 'testIfc.multiHint' : null;
  if (boxOpen) return null;
  return <aside className="testifc-quick-tools" aria-label={t('testIfc.tools')}>
    <div className="testifc-quick-tools__rail" role="toolbar" aria-label={t('testIfc.tools')}>
      {items.map(({ mode: id, key, Icon }) => <button key={id} type="button"
        data-quick-tool={id} title={t(key)} aria-label={t(key)}
        aria-pressed={id === 'measure' ? tool === 'measure' : tool === 'select' && mode === id}
        disabled={id !== 'model' && !ready} onClick={() => activate(id)}><Icon size={23} /></button>)}
    </div>
    {hint && <p className="testifc-quick-tools__hint">{t(hint)}</p>}
    {tool === 'measure' && <fieldset className="testifc-quick-tools__options" aria-label={t('testIfc.measure')}>
      {(['drag', 'polyline'] as const).map(id => <button key={id} type="button" aria-pressed={measureMode === id}
        onClick={() => useViewerStore.getState().setMeasureMode(id)}>{t(id === 'drag' ? 'testIfc.points' : 'testIfc.polyline')}</button>)}
    </fieldset>}
  </aside>;
}
