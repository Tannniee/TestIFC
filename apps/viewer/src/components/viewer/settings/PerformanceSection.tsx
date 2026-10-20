/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { isPreviewTier } from '@/store/geometryFidelity';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { activeStickyOverrides } from './sticky-overrides';

/** Reveal sticky load-time geometry inputs and provide one reset per input. */
export function PerformanceSection() {
  const { t } = useTranslation();
  const tier = useViewerStore((state) => state.geomTierOverride);
  const geometryMode = useViewerStore((state) => state.geometryMode);
  const fastView = useViewerStore((state) => state.fastView);
  const setFastView = useViewerStore((state) => state.setFastView);
  const [, refresh] = useState(0);
  const overrides = activeStickyOverrides(tier);

  return (
    <div className="space-y-4">
    <SettingsGroup title={t('settings.performance.navigationTitle')}>
      <p className="text-xs text-muted-foreground">{t('settings.performance.navigationHint')}</p>
      <SettingsRow label={t('settings.performance.fastView')} hint={t('settings.performance.fastViewHint')} htmlFor="settings-fast-view">
        <Switch id="settings-fast-view" checked={fastView} onCheckedChange={setFastView} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t('settings.performance.overridesTitle')}>
      <p className="text-xs text-muted-foreground">{t('settings.performance.overridesHint')}</p>
      {overrides.length === 0 && <p className="text-sm text-muted-foreground">{t('settings.performance.noOverrides')}</p>}
      {overrides.map(({ definition, value, source }) => (
        <div key={definition.id} className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t(definition.labelKey)}: {value}</p>
            <p className="text-xs text-muted-foreground">
              {t(source === 'url' ? 'settings.performance.sourceUrl' : 'settings.performance.sourceSaved')}
            </p>
            {definition.id === 'geomTier' && geometryMode === 'exact' && isPreviewTier(tier) && (
              <p className="text-xs text-muted-foreground">{t('settings.performance.tierIgnoredInExact')}</p>
            )}
            {definition.id === 'geomWorkers' && (
              <p className="text-xs text-muted-foreground">{t('settings.performance.workersMayClamp')}</p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('settings.performance.resetNamed', { name: t(definition.labelKey) })}
            onClick={() => { definition.reset(); refresh((value) => value + 1); }}
          >
            {t('settings.performance.reset')}
          </Button>
        </div>
      ))}
    </SettingsGroup>
    </div>
  );
}
