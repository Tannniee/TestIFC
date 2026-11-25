/* SPDX-License-Identifier: MPL-2.0 */
import { FolderOpen } from 'lucide-react';
import { isLocalDesktop } from '@/lib/desktop-shell';
import { useTranslation } from '@/i18n';
import { ViewportWelcomeCard, type ViewportWelcomeCardProps } from './ViewportWelcomeCard';
import { WelcomeFooterChips } from './WelcomeFooterChips';

export function ViewportStartScreen(props: ViewportWelcomeCardProps) {
  const { t } = useTranslation();
  if (!isLocalDesktop()) return <><ViewportWelcomeCard {...props} /><WelcomeFooterChips /></>;
  return <div className="space-y-3 text-center" data-desktop-start>
    <button type="button" onClick={props.onOpenClick} disabled={!props.webgpu.supported || props.webgpu.checking}
      className="inline-flex items-center gap-2 rounded-md border bg-background px-5 py-3 text-sm font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
      <FolderOpen aria-hidden="true" className="h-5 w-5" />{t('desktopShell.open')}
    </button>
    <p className="text-xs text-muted-foreground">{t('desktopShell.drop')}</p>
  </div>;
}
