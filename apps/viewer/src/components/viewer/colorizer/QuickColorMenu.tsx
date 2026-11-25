/* SPDX-License-Identifier: MPL-2.0 */
import { Palette } from 'lucide-react';
import { ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuItem } from '@/components/ui/context-menu';
import { colorizerRuntime } from '@/lib/colorizer/types';
import { requestQuickPaint } from '@/lib/colorizer/quick-paint';
import { useTranslation } from '@/i18n';
import { toast } from '@/components/ui/toast';

export function QuickColorMenu({ entityId, close }: { entityId: number; close: () => void }) {
  const { t } = useTranslation();
  if (!colorizerRuntime()) return null;
  const paint = (hex: string) => {
    try { requestQuickPaint(entityId, hex); close(); }
    catch (failure) { toast.error(failure instanceof Error ? failure.message : String(failure)); }
  };
  return <ContextMenuSub>
    <ContextMenuSubTrigger className="flex items-center gap-2 px-3 py-1.5 text-sm"><Palette className="h-4 w-4" />{t('colorizer.quick')}</ContextMenuSubTrigger>
    <ContextMenuSubContent className="p-2">
      <div className="flex gap-1">{['#ff0000', '#ff9900', '#ffff00', '#00bb66', '#0088ff', '#aa55ff', '#808080'].map(hex =>
        <ContextMenuItem key={hex} onSelect={() => paint(hex)} aria-label={hex}>
          <span className="block h-6 w-6 rounded border" style={{ backgroundColor: hex }} />
        </ContextMenuItem>)}</div>
      <label className="mt-2 flex items-center justify-between gap-2 text-xs">{t('colorizer.color')}
        <input type="color" defaultValue="#ff0000" aria-label={t('colorizer.quickCustom')} className="h-8 w-12" onChange={event => paint(event.target.value)} />
      </label>
    </ContextMenuSubContent>
  </ContextMenuSub>;
}
