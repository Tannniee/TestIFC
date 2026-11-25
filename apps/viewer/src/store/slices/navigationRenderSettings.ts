/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const FAST_VIEW_STORAGE_KEY = 'ifc-lite-fast-view';

export interface NavigationRenderSettings {
  fastView: boolean;
  setFastView: (enabled: boolean) => void;
}

export function getInitialFastView(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(FAST_VIEW_STORAGE_KEY) === 'true';
  } catch (err) {
    console.warn('[fast-view] storage unavailable; using clear view', err);
    return false;
  }
}

export function createNavigationRenderSettings(
  set: (partial: Partial<NavigationRenderSettings>) => void,
): NavigationRenderSettings {
  return {
    fastView: getInitialFastView(),
    setFastView: (fastView) => {
      try {
        localStorage.setItem(FAST_VIEW_STORAGE_KEY, String(fastView));
      } catch (err) {
        console.warn('[fast-view] persist failed; in-memory only', err);
      }
      set({ fastView });
    },
  };
}
