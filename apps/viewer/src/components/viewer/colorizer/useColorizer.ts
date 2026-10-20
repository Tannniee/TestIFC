/* SPDX-License-Identifier: MPL-2.0 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { uniqueColor } from '@ifc-lite/lens';
import { useViewerStore } from '@/store';
import { resolveEntityRef } from '@/store/resolveEntityRef';
import { toGlobalIdFromModels } from '@/store/globalId';
import { modelCopyExportDenial } from '@/store/mutation-permission';
import { colorizerBatches, emptyColorizerHistory, paintColorizer, redoColorizer, restoreColorizer, undoColorizer } from '@/lib/colorizer/draft';
import { captureColorizerSnapshot, type ColorizerSnapshot } from '@/lib/colorizer/snapshot';
import { colorizerRuntime, type ColorizerBatch, type ColorizerCatalog, type ColorizerColor, type ColorizerGrouping, type ColorizerSession } from '@/lib/colorizer/types';
import { downloadBlob, downloadFile, modelExportFilename } from '@/lib/export/download';
import { packagePortableIfcAsync } from '@/lib/export/portable-ifc';
import { modelAppearanceAssets } from '@/lib/appearance/model-assets';
import { spliceScheduleIntoExport } from '@/sdk/adapters/export-schedule-splice';
import { useTranslation } from '@/i18n';
import { consumeQuickPaint, useQuickPaint } from '@/lib/colorizer/quick-paint';

const LAYER = 'colorizer-preview';
const color = (hex: string, transparency: number): ColorizerColor => [
  parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255, 1 - transparency / 100,
];

export function useColorizer(enabled: boolean) {
  const { t } = useTranslation();
  const models = useViewerStore(state => state.models);
  const activeModelId = useViewerStore(state => state.activeModelId);
  const collabRole = useViewerStore(state => state.collabRole);
  const loading = useViewerStore(state => state.loading);
  const rendererSelection = useViewerStore(state => state.selectedEntityIds);
  const requests = useQuickPaint(state => state.requests);
  const [modelId, setModelId] = useState(() => activeModelId ?? models.keys().next().value ?? '');
  const [grouping, setGrouping] = useState<ColorizerGrouping>({ mode: 'section', property: '' });
  const [catalog, setCatalog] = useState<ColorizerCatalog | null>(null);
  const [catalogGrouping, setCatalogGrouping] = useState('');
  const [history, setHistory] = useState(emptyColorizerHistory);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [hex, setHex] = useState('#ff0000');
  const [transparency, setTransparency] = useState(0);
  const [busy, setBusy] = useState(false);
  const [regrouping, setRegrouping] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [sourceVersion, setSourceVersion] = useState(0);
  const [paused, setPaused] = useState(false);
  const session = useRef<ColorizerSession | null>(null);
  const snapshot = useRef<ColorizerSnapshot | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const groupSelection = useRef<ReadonlySet<number> | null>(null);
  const groupingRef = useRef(grouping); groupingRef.current = grouping;
  const lastRegroup = useRef('');
  const available = !!colorizerRuntime();
  const denial = modelId ? modelCopyExportDenial(useViewerStore.getState(), modelId) : null;
  void collabRole;

  useEffect(() => {
    if (groupSelection.current && rendererSelection !== groupSelection.current) {
      groupSelection.current = null;
      setSelected(new Set());
    }
  }, [rendererSelection]);

  const discard = useCallback(() => {
    generation.current++;
    setRegrouping(false);
    controller.current?.abort(); controller.current = null;
    const current = session.current; session.current = null; snapshot.current = null;
    if (current) void current.close().catch(failure => console.error('[Colorizer] cleanup failed', failure));
    useViewerStore.getState().removeOverlayLayer(LAYER);
  }, []);

  useEffect(() => () => discard(), [discard]);
  useEffect(() => useViewerStore.subscribe(() => {
    const source = snapshot.current;
    if (!source) return;
    try { source.validate(); }
    catch (failure) {
      console.info('[Colorizer] Reading updated model source', failure);
      discard(); setBusy(false); setCatalog(null); setHistory(emptyColorizerHistory());
      setError(''); setPaused(false); setSourceVersion(value => value + 1);
    }
  }), [discard]);
  useEffect(() => {
    const source = snapshot.current;
    if (source && models.get(source.modelId)?.ifcDataStore !== source.dataStore) {
      discard(); setCatalog(null); setHistory(emptyColorizerHistory()); setBusy(false); setSourceVersion(value => value + 1);
    }
  }, [models, discard]);

  useEffect(() => {
    if (!enabled) return;
    const source = snapshot.current;
    if (!source || !history.present.size || !models.has(source.modelId)) {
      useViewerStore.getState().removeOverlayLayer(LAYER); return;
    }
    const colors = new Map<number, [number, number, number, number]>();
    // The existing overlay alpha means tint strength, not IFC transparency.
    // Preview the authored hue opaquely; retain the real alpha in the draft/export.
    for (const [id, rgba] of history.present) colors.set(toGlobalIdFromModels(models, source.modelId, id), [rgba[0], rgba[1], rgba[2], 1]);
    useViewerStore.getState().registerOverlayLayer({ id: LAYER, priority: 75, hiddenIds: null, colorOverrides: colors });
  }, [enabled, history.present, models]);

  const validate = useCallback(() => {
    const source = snapshot.current;
    if (!source) throw new Error(t('colorizer.preparing'));
    const denied = modelCopyExportDenial(useViewerStore.getState(), source.modelId);
    if (denied) throw new Error(denied);
    source.validate();
    return source;
  }, [t]);
  const fail = useCallback((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)), []);

  const prepare = useCallback(async () => {
    discard();
    const version = generation.current;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setMessage(t('colorizer.preparing')); setProgress(null);
    setCatalog(null); setHistory(emptyColorizerHistory()); setSelected(new Set());
    try {
      if (denial) throw new Error(denial);
      const runtime = colorizerRuntime();
      if (!runtime) throw new Error(t('colorizer.nativeRequired'));
      const source = captureColorizerSnapshot(modelId);
      snapshot.current = source;
      const opened = await runtime.open(source.source, source.mutations, { signal: abort.signal,
        onProgress: (done, total) => { if (version === generation.current) setProgress(Math.round(done / total * 100)); } });
      if (version !== generation.current) { await opened.close(); return; }
      session.current = opened; setProgress(null);
      const requestedGrouping = groupingRef.current;
      const result = await opened.catalog(requestedGrouping);
      source.validate(); abort.signal.throwIfAborted();
      if (version !== generation.current) return;
      setCatalog(result); setCatalogGrouping(JSON.stringify(requestedGrouping)); setMessage(''); setProgress(null);
    } catch (failure) {
      if (version === generation.current) { fail(failure); setBusy(false); discard(); }
    } finally { if (version === generation.current) setBusy(false); }
  }, [modelId, denial, discard, t, fail]);

  useEffect(() => {
    if (!models.has(modelId)) {
      const next = activeModelId && models.has(activeModelId) && models.get(activeModelId)?.schemaVersion !== 'IFC5' ? activeModelId
        : [...models.values()].find(model => model.schemaVersion !== 'IFC5')?.id ?? '';
      if (next !== modelId) setModelId(next);
    }
  }, [models, activeModelId, modelId]);
  useEffect(() => {
    if (snapshot.current && (snapshot.current.modelId !== modelId || denial)) {
      discard(); setCatalog(null); setHistory(emptyColorizerHistory()); setBusy(false);
    }
  }, [modelId, denial, discard]);
  useEffect(() => {
    if (!enabled || !available || !modelId || loading || denial || paused || snapshot.current) return;
    void prepare();
  }, [enabled, available, modelId, loading, denial, paused, sourceVersion, prepare]);

  const regroup = useCallback(async () => {
    const version = generation.current;
    setRegrouping(true); setError(''); setMessage('');
    try {
      validate();
      if (!session.current) throw new Error(t('colorizer.preparing'));
      const result = await session.current.catalog(grouping);
      validate();
      if (version === generation.current) {
        if (useViewerStore.getState().selectedEntityIds === groupSelection.current) useViewerStore.getState().clearEntitySelection();
        groupSelection.current = null;
        setCatalog(result); setCatalogGrouping(JSON.stringify(grouping)); setSelected(new Set());
      }
    } catch (failure) { if (version === generation.current) fail(failure); }
    finally { if (version === generation.current) setRegrouping(false); }
  }, [grouping, validate, fail, t]);

  useEffect(() => {
    if (!catalog || busy || regrouping || catalogGrouping === JSON.stringify(grouping)) return;
    if (grouping.mode === 'property' && !grouping.property.trim()) return;
    const key = `${generation.current}:${JSON.stringify(grouping)}`;
    if (lastRegroup.current === key) return;
    const timer = setTimeout(() => { lastRegroup.current = key; void regroup(); }, 250);
    return () => clearTimeout(timer);
  }, [grouping, busy, regrouping, catalog, catalogGrouping, regroup]);

  const paint = (batches: ColorizerBatch[]) => {
    try { validate(); setError(''); setHistory(previous => paintColorizer(previous, batches)); }
    catch (failure) { fail(failure); }
  };
  const paintGroups = () => paint((catalog?.groups ?? []).filter(group => selected.has(group.name))
    .map(group => ({ products: group.products, color: color(hex, transparency) })));
  const picked = () => {
    const ids: number[] = [];
    const valid = new Set(catalog?.productIds ?? []);
    for (const global of useViewerStore.getState().selectedEntityIds) {
      const ref = resolveEntityRef(global);
      if (ref.modelId === modelId && valid.has(ref.expressId)) ids.push(ref.expressId);
    }
    return ids;
  };
  const select3d = (products: number[]) => {
    const state = useViewerStore.getState();
    state.clearEntitySelection();
    state.addEntitiesToSelection(products.map(expressId => ({ modelId, expressId })));
    state.setSelectedEntityIds(products.map(id => toGlobalIdFromModels(state.models, modelId, id)));
    groupSelection.current = useViewerStore.getState().selectedEntityIds;
  };

  useEffect(() => {
    const request = requests[0];
    if (!request) return;
    if (models.get(request.modelId)?.ifcDataStore !== request.source) {
      consumeQuickPaint(request); fail(new Error('The selected model has changed.')); return;
    }
    if (request.modelId !== modelId) { setModelId(request.modelId); setPaused(false); return; }
    if (!catalog || busy || denial) return;
    consumeQuickPaint(request);
    try {
      validate();
      const valid = new Set(catalog.productIds);
      const products = request.products.filter(id => valid.has(id));
      if (!products.length) throw new Error('No colourable objects selected.');
      setHistory(previous => paintColorizer(previous, [{ products, color: request.color }]));
      setHex(`#${request.color.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`);
      setTransparency(0);
    } catch (failure) { fail(failure); }
  }, [requests, models, modelId, catalog, busy, denial, validate, fail]);

  const exportIfc = async () => {
    const version = generation.current;
    setBusy(true); setError(''); setMessage(t('colorizer.exporting')); setProgress(null);
    try {
      const source = validate();
      const opened = session.current;
      if (!opened) throw new Error(t('colorizer.preparing'));
      const blob = await opened.export(colorizerBatches(history.present), (done, total) => {
        if (version === generation.current) setProgress(Math.round(done / total * 100));
      });
      validate();
      if (version !== generation.current) return;
      const archive = modelAppearanceAssets.exportResources(modelId);
      const scheduleEdited = source.scheduleState.scheduleIsEdited && source.scheduleState.scheduleSourceModelId === modelId;
      if (archive.resources.size || scheduleEdited) {
        let content: string | Uint8Array = new Uint8Array(await blob.arrayBuffer());
        if (scheduleEdited) content = spliceScheduleIntoExport({ content }, modelId, source.dataStore, source.scheduleState).content;
        const artifact = await packagePortableIfcAsync(modelId, content, { exportResources: () => archive });
        validate(); if (version !== generation.current) return;
        downloadFile(artifact.content, modelExportFilename(source.name, artifact.ext, '_colored'), artifact.mime);
      } else downloadBlob(blob, modelExportFilename(source.name, 'ifc', '_colored'));
      setMessage(t('colorizer.exported'));
    } catch (failure) { if (version === generation.current) fail(failure); }
    finally { if (version === generation.current) { setBusy(false); setProgress(null); } }
  };

  const savePalette = () => {
    try {
    validate();
    const groups = (catalog?.groups ?? []).flatMap(group => {
      const rgba = history.present.get(group.products[0]);
      const paints = group.products.map(id => history.present.get(id));
      if (paints.some(value => value?.join(',') !== rgba?.join(','))) throw new Error('A group has mixed colours. Paint that whole group before saving its palette.');
      return rgba ? [{ name: group.name, color: rgba }] : [];
    });
    downloadFile(JSON.stringify({ format: 'ifc-lite-colorizer', version: 1, grouping, groups }, null, 2), 'colorizer-palette.json', 'application/json');
    } catch (failure) { fail(failure); }
  };
  const loadPalette = async (file: File) => {
    const version = generation.current;
    setBusy(true); setError('');
    try {
      validate();
      if (file.size > 5 * 1024 * 1024) throw new Error(t('colorizer.paletteInvalid'));
      const value: unknown = JSON.parse(await file.text());
      if (version !== generation.current) return;
      if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 'ifc-lite-colorizer'
        || !('version' in value) || value.version !== 1 || !('grouping' in value)
        || !value.grouping || typeof value.grouping !== 'object' || !('mode' in value.grouping)
        || value.grouping.mode !== grouping.mode || !('property' in value.grouping) || value.grouping.property !== grouping.property
        || !('groups' in value) || !Array.isArray(value.groups)) throw new Error(t('colorizer.paletteInvalid'));
      const batches: ColorizerBatch[] = [];
      const names = new Set<string>();
      for (const row of value.groups) {
        if (!row || typeof row !== 'object' || typeof row.name !== 'string' || names.has(row.name) || !Array.isArray(row.color)
          || row.color.length !== 4 || row.color.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) throw new Error(t('colorizer.paletteInvalid'));
        names.add(row.name);
        const group = catalog?.groups.find(group => group.name === row.name);
        if (group) batches.push({ products: group.products, color: [row.color[0], row.color[1], row.color[2], row.color[3]] });
      }
      if (!batches.length) throw new Error(t('colorizer.paletteInvalid'));
      paint(batches);
    } catch (failure) { if (version === generation.current) fail(failure); }
    finally { if (version === generation.current) setBusy(false); }
  };

  return { models, modelId, setModelId: (id: string) => { discard(); setModelId(id); setPaused(false); setCatalog(null); setHistory(emptyColorizerHistory()); setSelected(new Set()); },
    grouping, setGrouping, catalog, selected, setSelected: (names: ReadonlySet<string>) => {
      setSelected(names);
      select3d([...new Set((catalog?.groups ?? []).filter(group => names.has(group.name)).flatMap(group => group.products))]);
    }, hex, setHex, transparency, setTransparency,
    busy, regrouping, paused, message, error, progress, available, denial, history, retry: () => {
      if (session.current) void regroup();
      else if (paused) setPaused(false);
      else void prepare();
    }, paintGroups, select3d, exportIfc, savePalette, loadPalette,
    groupingReady: catalogGrouping === JSON.stringify(grouping),
    cancel: () => { discard(); setPaused(true); setBusy(false); setCatalog(null); setHistory(emptyColorizerHistory()); setMessage(t('colorizer.cancelled')); },
    gray: () => paint([{ products: catalog?.productIds ?? [], color: [128 / 255, 128 / 255, 128 / 255, 1] }]),
    auto: () => paint((catalog?.groups ?? []).map((group, index) => ({ products: group.products, color: color(uniqueColor(index), 0) }))),
    paintPicked: () => paint([{ products: picked(), color: color(hex, transparency) }]),
    undo: () => setHistory(undoColorizer), redo: () => setHistory(redoColorizer), restore: () => setHistory(restoreColorizer),
  };
}
