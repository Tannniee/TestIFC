/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useState, type RefObject } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { modelDropAction, type ModelDropAction } from './modelDropAction';

export function ModelFileDropOverlay({ modelCount, replaceZoneRef }: {
  modelCount: number;
  replaceZoneRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const [action, setAction] = useState<ModelDropAction>('add');
  useEffect(() => {
    const track = (event: DragEvent) => {
      setAction(modelDropAction(event, replaceZoneRef.current?.getBoundingClientRect()));
    };
    window.addEventListener('dragover', track, true);
    return () => window.removeEventListener('dragover', track, true);
  }, [replaceZoneRef]);

  // Pass events through to the one window drop handler. Native OS file drags
  // retain the same target while crossing cards, so the overlay never flickers.
  const card = 'border-2 border-dashed rounded-lg px-6 py-5 text-center transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none';
  return (
    <div className="pointer-events-none fixed inset-0 z-50 bg-background/60 backdrop-blur-[2px] flex items-center justify-center p-4">
      <output className="flex w-full max-w-sm flex-col gap-4" aria-live="polite">
        <div data-model-drop-action="add" className={`${card} border-status-ok ${action === 'add' ? 'bg-status-ok/15 ring-2 ring-status-ok/50 shadow-xl' : 'bg-background/95'}`}>
          <Plus className="h-10 w-10 mx-auto text-status-ok mb-3" aria-hidden="true" />
          <p className="text-lg font-black uppercase text-status-ok">{t('viewportLighting.container.dropOverlay.addModelTitle')}</p>
          <p className="text-xs font-mono text-muted-foreground mt-2">{t('viewportLighting.container.dropOverlay.addModelSubtitle', { count: modelCount })}</p>
        </div>
        <div ref={replaceZoneRef} data-model-drop-action="replace" className={`${card} border-primary ${action === 'replace' ? 'bg-primary/15 ring-2 ring-primary/50 shadow-xl' : 'bg-background/95'}`}>
          <RefreshCw className="h-10 w-10 mx-auto text-primary mb-3" aria-hidden="true" />
          <p className="text-lg font-black uppercase text-primary">{t('viewportLighting.container.dropOverlay.replaceModelTitle')}</p>
          <p className="text-xs font-mono text-muted-foreground mt-2">{t('viewportLighting.container.dropOverlay.replaceModelSubtitle', { count: modelCount })}</p>
        </div>
      </output>
    </div>
  );
}
