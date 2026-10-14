/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect } from 'react';
import { useViewerStore } from '@/store';
import { applyThemeClasses } from '@/store/slices/uiSlice.helpers';

/**
 * Keep the document's theme classes in sync with the store's theme. The
 * initial class is set by the inline script in index.html, so this only
 * follows changes.
 */
export function useThemeDocumentClass(): void {
  const theme = useViewerStore((s) => s.theme);
  useEffect(() => {
    applyThemeClasses(theme);
  }, [theme]);
}
