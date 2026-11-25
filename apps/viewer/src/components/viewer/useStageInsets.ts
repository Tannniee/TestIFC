/* SPDX-License-Identifier: MPL-2.0 */
import { useLayoutEffect } from 'react';

/** Move HUD controls clear of covering docks without moving the camera surface. */
export function useStageInsets(stage: HTMLElement | null): void {
  useLayoutEffect(() => {
    if (!stage) return;
    const targets = [
      [stage.parentElement?.querySelector('.viewer-ribbon-band'), '--viewer-ribbon-overlay', 'height'],
      [stage.querySelector('.viewer-sidebar-reveal'), '--viewer-right-overlay', 'width'],
      [stage.querySelector('.viewer-main-split > [data-panel]:first-child'), '--viewer-left-overlay', 'width'],
    ] as const;
    const update = () => {
      const bounds = stage.getBoundingClientRect();
      const frame = stage.querySelector<HTMLElement>('[data-camera-viewport]');
      for (const [element, property, dimension] of targets) {
        stage.style.setProperty(property, `${element?.getBoundingClientRect()[dimension] ?? 0}px`);
      }
      if (frame) {
        const rect = frame.getBoundingClientRect();
        const ribbon = targets[0][0]?.getBoundingClientRect().height ?? 0;
        const right = targets[1][0]?.getBoundingClientRect().width ?? 0;
        const left = targets[2][0]?.getBoundingClientRect().width ?? 0;
        frame.style.setProperty('--viewer-hud-top', `${Math.max(0, ribbon - (rect.top - bounds.top))}px`);
        frame.style.setProperty('--viewer-hud-left', `${Math.max(0, left - (rect.left - bounds.left))}px`);
        frame.style.setProperty('--viewer-hud-right', `${Math.max(0, right - (bounds.right - 64 - rect.right))}px`);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    for (const [element] of targets) if (element) observer.observe(element);
    let frame: HTMLElement | null = null;
    const watchFrame = () => {
      const next = stage.querySelector<HTMLElement>('[data-camera-viewport]');
      if (next === frame) return;
      if (frame) observer.unobserve(frame);
      frame = next;
      if (frame) observer.observe(frame);
      update();
    };
    watchFrame();
    const mounts = new MutationObserver(watchFrame);
    mounts.observe(stage, { childList: true, subtree: true });
    return () => {
      mounts.disconnect();
      observer.disconnect();
      for (const [, property] of targets) stage.style.removeProperty(property);
    };
  }, [stage]);
}
