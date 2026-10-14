/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useState } from 'react';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { HudItem } from '../../viewport-ui/hud';
import { HudSurface } from '../../viewport-ui/hud/HudSurface';
import { useSectionDistance } from './useSectionDistance';
import { sectionBoxFromBounds } from '@/lib/section/section-box';
import { IFC_BOX_AXES, editIfcBoxValue, ifcBoxValue } from '@/lib/section/testifc-box-math';
import { applyEditedBox, beginBoxDraw, cancelBoxDraw, useTestIfcBoxUi } from '@/lib/section/testifc-box-controller';

export function TestIfcBoxPanel() {
  const { t } = useTranslation();
  const plane = useViewerStore(s => s.sectionPlane);
  const ui = useTestIfcBoxUi();
  const distance = useSectionDistance();
  const [invalid, setInvalid] = useState(false);
  const [values, setValues] = useState<string[]>([]);
  const box = plane.box;
  useEffect(() => {
    if (box) setValues(IFC_BOX_AXES.flatMap((_, index) => (['min', 'max'] as const).map(side => String(ifcBoxValue(box, index, side)))));
    setInvalid(false);
  }, [box]);
  if (!box) return null;
  const busy = ui.phase !== 'idle';
  const commit = (index: number, side: 'min' | 'max', raw: string) => {
    const next = raw.trim() ? editIfcBoxValue(box, index, side, Number(raw)) : null;
    setInvalid(!next);
    if (next) applyEditedBox(next);
  };
  return <HudItem region="top-left" order={1}>
    <HudSurface data-testid="testifc-box-panel" className="w-52 max-w-full p-3 text-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <strong>{t('testIfc.box.heading')}</strong>
        <button type="button" aria-label={t('sectionTool.closeTitle')} className="px-2"
          onClick={() => { cancelBoxDraw(); useViewerStore.getState().setActiveTool('select'); }}>×</button>
      </div>
      <fieldset disabled={busy} className="grid grid-cols-[20px_1fr_1fr] gap-2">
        <span /><span>{t('testIfc.box.min')}</span><span>{t('testIfc.box.max')}</span>
        {IFC_BOX_AXES.map(({ label }, index) => <div key={label} className="contents">
          <span className="self-center font-semibold">{label}</span>
          {(['min', 'max'] as const).map((side, column) => <input key={side} type="number" step="0.1"
            aria-label={`IFC ${label} ${t(side === 'min' ? 'testIfc.box.min' : 'testIfc.box.max')}`}
            aria-invalid={invalid} data-box-limit={`${label}-${side}`}
            className="min-w-0 rounded border border-input bg-background px-1.5 py-1 tabular-nums"
            value={values[index * 2 + column] ?? ''}
            onChange={event => setValues(v => v.map((value, i) => i === index * 2 + column ? event.target.value : value))}
            onBlur={event => commit(index, side, event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />)}
        </div>)}
      </fieldset>
      <div className="my-3 flex flex-wrap gap-x-3 gap-y-2">
        <label className="flex items-center gap-1"><input type="checkbox" disabled={busy} checked={ui.showBox}
          onChange={event => useTestIfcBoxUi.setState({ showBox: event.target.checked })} />{t('testIfc.box.showBox')}</label>
        <label className="flex items-center gap-1"><input type="checkbox" disabled={busy} checked={ui.showHandles}
          onChange={event => useTestIfcBoxUi.setState({ showHandles: event.target.checked })} />{t('testIfc.box.showHandles')}</label>
      </div>
      {(invalid || ui.error) && <p role="alert" className="mb-2 text-destructive">{t(invalid ? 'testIfc.box.valueError' : ui.error!)}</p>}
      {busy ? <button type="button" className="rounded border px-2 py-1" onClick={() => cancelBoxDraw()}>{t('testIfc.box.cancel')}</button>
        : <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded border px-2 py-1" onClick={() => beginBoxDraw(distance.bounds)}>{t('testIfc.box.draw')}</button>
          <button type="button" className="rounded border px-2 py-1" onClick={() => useViewerStore.getState().cameraCallbacks.frameSectionBox?.()}>{t('testIfc.box.fit')}</button>
          <button type="button" className="rounded border px-2 py-1" onClick={() => { const next = sectionBoxFromBounds(distance.bounds); if (next) applyEditedBox(next); }}>{t('testIfc.box.reset')}</button>
        </div>}
    </HudSurface>
  </HudItem>;
}
