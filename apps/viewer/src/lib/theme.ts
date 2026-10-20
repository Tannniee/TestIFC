/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ThemeMode } from '@/store/slices/uiSlice';

export function isDarkTheme(theme: ThemeMode | undefined): boolean {
  return theme === 'dark' || theme === 'oled';
}

/** Keep the chosen dark palette when the sun/moon shortcut returns from light. */
export function persistTheme(theme: ThemeMode): void {
  localStorage.setItem('ifc-lite-theme', theme);
  if (isDarkTheme(theme)) localStorage.setItem('ifc-lite-dark-theme', theme);
}

export function nextToggleTheme(current: ThemeMode): ThemeMode {
  if (isDarkTheme(current)) return 'light';
  return localStorage.getItem('ifc-lite-dark-theme') === 'oled' ? 'oled' : 'dark';
}
