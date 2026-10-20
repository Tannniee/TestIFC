/* SPDX-License-Identifier: MPL-2.0 */
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { styleInterpolatedValues } from '@/i18n/richInterpolate';
import { isSafeMode } from '@/lib/safe-mode';
const SAFE_MODE_QUERY_FLAG = '?safe=0';

export function SafeModeNotice() {
  const { t } = useTranslation();
  if (!isSafeMode()) return null;
  return <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1 text-2xs text-amber-700 dark:text-amber-300">
    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
    <span>{styleInterpolatedValues(t, 'shellChrome.layout.safeModeNotice', [
      ['flag', <code key="flag" className="font-mono">{SAFE_MODE_QUERY_FLAG}</code>],
    ])}</span>
  </div>;
}
