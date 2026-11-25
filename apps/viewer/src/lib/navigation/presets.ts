/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  resolvePointerGesture,
  type PointerGesture,
  type PointerGestureInput,
} from '@/components/viewer/pointerGesture.js';

export type NavigationPreset = 'default' | 'navisworks' | 'trackpad' | 'testifc';

/** Only differences from #5887's shared pointer mapping live in this table. */
const PRESET_RULES = {
  testifc: { shiftMiddle: 'orbit', wheel: 'zoom' },
  default: { shiftMiddle: 'pan', wheel: 'zoom-and-horizontal-pan' },
  navisworks: { shiftMiddle: 'orbit', wheel: 'zoom' },
  trackpad: { shiftMiddle: 'pan', wheel: 'pan-unless-ctrl' },
} as const satisfies Record<NavigationPreset, {
  shiftMiddle: 'pan' | 'orbit';
  wheel: 'zoom-and-horizontal-pan' | 'zoom' | 'pan-unless-ctrl';
}>;

export const NAVIGATION_PRESETS: readonly NavigationPreset[] = ['testifc', 'default', 'navisworks', 'trackpad'];

/** A persisted choice is untrusted browser data. Unknown values use the default. */
export function parseNavigationPreset(value: string | null): NavigationPreset {
  return NAVIGATION_PRESETS.find((preset) => preset === value) ?? 'default';
}

/** #5889: preset overrides build on the shared #5887 button/modifier mapping. */
export function resolveNavigationPointerGesture(
  preset: NavigationPreset,
  input: PointerGestureInput & { multiSelect?: boolean },
): PointerGesture {
  if (preset === 'testifc') {
    const modified = input.shiftKey || input.ctrlKey || input.metaKey;
    if (input.button === 2) return modified ? 'orbit' : 'pan';
    if (input.button === 1) return (input.multiSelect ? !modified : modified) ? 'orbit' : 'pan';
    if (input.button === 0 && input.multiSelect && !input.altKey) return 'tool';
    if (input.button === 0 && input.tool === 'select') return modified ? 'pan' : 'orbit';
  }
  if (input.button === 1 && input.shiftKey) return PRESET_RULES[preset].shiftMiddle;
  return resolvePointerGesture(input);
}

export interface WheelNavigation {
  /** Camera pan inputs in the same screen-pixel convention as a pointer drag. */
  panX: number;
  panY: number;
  /** Reuse the established surface/fine zoom handler when true. */
  zoom: boolean;
}

/** A pinch arrives as ctrl+wheel, including when no physical Ctrl key was held. */
export function resolveWheelNavigation(
  preset: NavigationPreset,
  input: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'ctrlKey'>,
): WheelNavigation {
  const wheel = PRESET_RULES[preset].wheel;
  if (wheel === 'pan-unless-ctrl' && !input.ctrlKey) {
    return { panX: -input.deltaX || 0, panY: -input.deltaY || 0, zoom: false };
  }
  if (wheel === 'zoom-and-horizontal-pan' && input.deltaX !== 0 && !input.ctrlKey) {
    return { panX: -input.deltaX, panY: 0, zoom: input.deltaY !== 0 };
  }
  return { panX: 0, panY: 0, zoom: input.deltaY !== 0 };
}
