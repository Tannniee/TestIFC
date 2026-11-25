/* SPDX-License-Identifier: MPL-2.0 */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import type { ColorizerMode } from '@/lib/colorizer/types';
import { useColorizerWorkspace } from './ColorizerWorkspace';

const field = 'w-full rounded border bg-background px-2 py-1.5 text-xs';
const label = 'block space-y-1 text-xs font-medium';

export function ColorizerPanel() {
  const { t } = useTranslation();
  const tool = useColorizerWorkspace();
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(200);
  const paletteInput = useRef<HTMLInputElement>(null);
  const models = [...tool.models.values()].filter(model => model.schemaVersion !== 'IFC5');
  const filtered = (tool.catalog?.groups ?? []).filter(group => group.name.toLowerCase().includes(search.toLowerCase()));
  const disabled = tool.busy || !tool.catalog || !!tool.denial;
  const modes: ColorizerMode[] = ['section', 'class', 'material', 'storey', 'property'];

  return <section className="flex h-full min-h-0 flex-col bg-background" aria-label={t('colorizer.title')} aria-busy={tool.busy}>
    <div className="shrink-0 space-y-3 border-b p-3">
      <h2 className="text-sm font-semibold">{t('colorizer.title')}</h2>
      {models.length > 1 ? <label className={label}>{t('colorizer.file')}
        <select className={field} value={tool.modelId} disabled={tool.busy} onChange={event => tool.setModelId(event.target.value)}>
          {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label> : <p className="truncate text-xs text-muted-foreground" title={models[0]?.name}>{models[0]?.name ?? t('colorizer.noFile')}</p>}
      {!tool.available && <output className="block text-xs text-muted-foreground">{t('colorizer.nativeRequired')}</output>}
      {tool.denial && <p className="text-xs text-muted-foreground">{tool.denial}</p>}
      {tool.busy && !tool.catalog && <div className="flex items-center justify-between gap-2">
        <output className="text-xs text-muted-foreground">{tool.message || t('colorizer.preparing')}{tool.progress !== null ? ` ${tool.progress}%` : ''}</output>
        <Button size="sm" variant="ghost" onClick={tool.cancel}>{t('colorizer.cancel')}</Button>
      </div>}
      <Button type="button" size="sm" variant="secondary" className="w-full" disabled={disabled} onClick={tool.gray}>{t('colorizer.gray')}</Button>
      <label className={label}>{t('colorizer.groupBy')}
        <select className={field} aria-label={t('colorizer.groupBy')} value={tool.grouping.mode} disabled={!tool.catalog} onChange={event => {
          const mode = modes.find(mode => mode === event.target.value);
          if (mode) tool.setGrouping({ ...tool.grouping, mode });
        }}>{modes.map(mode => <option key={mode} value={mode}>{t(`colorizer.${mode}`)}</option>)}</select>
      </label>
      {tool.grouping.mode === 'property' && <label className={label}>{t('colorizer.propertyPath')}
        <input className={field} value={tool.grouping.property} placeholder={t('colorizer.propertyPlaceholder')} onChange={event => tool.setGrouping({ ...tool.grouping, property: event.target.value })} />
      </label>}
      <input className={field} aria-label={t('colorizer.search')} placeholder={t('colorizer.search')} value={search} onChange={event => { setSearch(event.target.value); setLimit(200); }} />
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      {tool.catalog && <>
        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t('colorizer.groupCount', { count: tool.catalog.groups.length })}</span>
          <button type="button" className="text-primary underline underline-offset-2 disabled:opacity-40" disabled={disabled || !tool.groupingReady} onClick={() => tool.setSelected(tool.selected.size ? new Set() : new Set(filtered.map(group => group.name)))}>
            {t(tool.selected.size ? 'colorizer.clearGroups' : 'colorizer.selectFiltered')}
          </button>
        </div>
        <table className="w-full text-xs"><thead className="text-muted-foreground"><tr><th scope="col" className="pb-2 text-left font-medium">{t('colorizer.group')}</th><th scope="col" className="pb-2 text-right font-medium">{t('colorizer.count')}</th></tr></thead>
          <tbody>{filtered.slice(0, limit).map(group => {
            const rgba = tool.history.present.get(group.products[0]);
            return <tr key={group.name} className="border-t">
              <td className="py-2 pr-2"><label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" disabled={disabled || !tool.groupingReady} checked={tool.selected.has(group.name)} aria-label={t('colorizer.selectGroup', { name: group.name })} onChange={event => {
                  const next = new Set(tool.selected); if (event.target.checked) next.add(group.name); else next.delete(group.name); tool.setSelected(next);
                }} />
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm border" style={rgba ? { backgroundColor: `rgb(${rgba.slice(0, 3).map(v => Math.round(v * 255)).join(' ')})` } : undefined} />
                <span className="min-w-0 break-words">{group.name}</span>
              </label></td>
              <td className="py-2 text-right tabular-nums"><button type="button" className="rounded px-1 underline underline-offset-2 focus-visible:outline focus-visible:outline-2" disabled={disabled} title={t('colorizer.select3d')} onClick={() => tool.select3d(group.products)}>{group.products.length}</button></td>
            </tr>;
          })}</tbody>
        </table>
        {filtered.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">{t('colorizer.noGroups')}</p>}
        {filtered.length > limit && <Button type="button" size="sm" variant="outline" className="mt-2 w-full" onClick={() => setLimit(limit + 200)}>{t('colorizer.showMore')}</Button>}
      </>}
    </div>
    <footer className="shrink-0 space-y-2 border-t p-3">
      <div className="flex items-end gap-2">
        <label className="shrink-0"><span className="sr-only">{t('colorizer.color')}</span><input className="h-9 w-11 cursor-pointer rounded border bg-background" type="color" value={tool.hex} disabled={disabled} onChange={event => tool.setHex(event.target.value)} /></label>
        <label className="min-w-0 flex-1 space-y-1 text-xs">{t('colorizer.transparency')}<input className={field} type="number" min={0} max={100} step={1} disabled={disabled} value={tool.transparency} onChange={event => tool.setTransparency(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /></label>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="min-w-0 flex-1" disabled={disabled || !tool.selected.size || !tool.groupingReady} onClick={tool.paintGroups}>{t('colorizer.apply', { count: tool.selected.size })}</Button>
      </div>
      <div className="flex items-center justify-between gap-1">
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={tool.paintPicked}>{t('colorizer.paintPicked')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || !tool.history.past.length} onClick={tool.undo}>{t('colorizer.undo')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || !tool.history.future.length} onClick={tool.redo}>{t('colorizer.redo')}</Button>
      </div>
      <details className="text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">{t('colorizer.options')}</summary>
        <div className="space-y-2 pt-2">
          <p className="text-muted-foreground">{t('colorizer.previewScope')}</p>
          {tool.grouping.mode === 'section' && <label className={label}>{t('colorizer.propertyPath')}<input className={field} disabled={disabled} value={tool.grouping.property} placeholder={t('colorizer.propertyPlaceholder')} onChange={event => tool.setGrouping({ ...tool.grouping, property: event.target.value })} /></label>}
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="sm" variant="outline" disabled={disabled || !tool.groupingReady} onClick={tool.auto}>{t('colorizer.auto')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={disabled || !tool.history.present.size} onClick={tool.restore}>{t('colorizer.restore')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={disabled || !tool.groupingReady} onClick={tool.savePalette}>{t('colorizer.paletteSave')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={disabled || !tool.groupingReady} onClick={() => paletteInput.current?.click()}>{t('colorizer.paletteLoad')}</Button>
            <input ref={paletteInput} type="file" accept=".json,application/json" className="hidden" aria-label={t('colorizer.paletteLoad')} onChange={event => {
              const file = event.target.files?.[0]; event.target.value = ''; if (file) void tool.loadPalette(file);
            }} />
          </div>
          <p className="text-muted-foreground">{t('colorizer.exportScope')}</p>
        </div>
      </details>
      {tool.error && <div className="flex items-start justify-between gap-2"><p role="alert" className="text-xs text-destructive">{tool.error}</p><Button size="sm" variant="outline" disabled={tool.busy} onClick={tool.retry}>{t('colorizer.retry')}</Button></div>}
      {!tool.busy && tool.message && <div className="flex items-center justify-between gap-2"><output className="text-xs text-muted-foreground">{tool.message}</output>{tool.paused && <Button size="sm" variant="outline" onClick={tool.retry}>{t('colorizer.retry')}</Button>}</div>}
      <div className="flex justify-end"><Button type="button" size="sm" disabled={disabled || tool.regrouping || !tool.history.present.size} onClick={() => { void tool.exportIfc(); }}>{t('colorizer.export')}</Button></div>
    </footer>
  </section>;
}
