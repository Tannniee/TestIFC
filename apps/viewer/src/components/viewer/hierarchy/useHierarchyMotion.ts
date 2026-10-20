/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/** FLIP only the mounted rows after an explicit expansion/grouping action.
 * Virtualizer positions stay untouched; normal scrolling never starts a fade. */
export function useHierarchyMotion(roots: readonly RefObject<HTMLDivElement | null>[]) {
  const rootsRef = useRef(roots);
  rootsRef.current = roots;
  const pending = useRef<Map<HTMLElement, { scroll: number; rows: Map<string, number> }> | null>(null);
  const animations = useRef(new Set<Animation>());
  const observed = useRef(new Set<HTMLElement>());
  const stop = useCallback(() => {
    for (const animation of animations.current) animation.cancel();
    animations.current.clear();
  }, []);
  const onScroll = useCallback(() => { pending.current = null; stop(); }, [stop]);
  const capture = useCallback(() => {
    for (const element of observed.current) {
      if (!element.isConnected) {
        element.removeEventListener('scroll', onScroll);
        observed.current.delete(element);
      }
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { stop(); return; }
    const before = new Map<HTMLElement, { scroll: number; rows: Map<string, number> }>();
    for (const ref of rootsRef.current) {
      if (!ref.current) continue;
      if (!observed.current.has(ref.current)) {
        ref.current.addEventListener('scroll', onScroll, { passive: true });
        observed.current.add(ref.current);
      }
      const rows = new Map<string, number>();
      for (const row of ref.current.querySelectorAll<HTMLElement>('[data-node-id]')) {
        rows.set(row.dataset.nodeId!, row.getBoundingClientRect().top);
      }
      before.set(ref.current, { scroll: ref.current.scrollTop, rows });
    }
    // Capture the displayed position before interrupting an earlier animation.
    stop();
    pending.current = before;
  }, [stop, onScroll]);

  useLayoutEffect(() => {
    const before = pending.current;
    pending.current = null;
    if (!before) return;
    for (const [root, snapshot] of before) {
      if (!root.isConnected || root.scrollTop !== snapshot.scroll) continue;
      for (const row of root.querySelectorAll<HTMLElement>('[data-node-id]')) {
        if (!row.animate) continue;
        const previous = snapshot.rows.get(row.dataset.nodeId!);
        const offset = previous === undefined ? 0 : previous - row.getBoundingClientRect().top;
        if (previous !== undefined && Math.abs(offset) < .5) continue;
        const opacity = getComputedStyle(row).opacity;
        const animation = row.animate([
          { transform: `translateY(${previous === undefined ? 3 : offset}px)`, opacity: previous === undefined ? '0' : opacity },
          { transform: 'translateY(0)', opacity },
        ], { duration: 140, easing: 'cubic-bezier(.2,.8,.2,1)' });
        animations.current.add(animation);
        void animation.finished.then(() => animations.current.delete(animation), (error: unknown) => {
          animations.current.delete(animation);
          // Scroll, another expansion and unmount intentionally cancel motion.
          if (!(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) {
            console.warn('[HierarchyMotion] animation failed', error);
          }
        });
      }
    }
  });
  useLayoutEffect(() => {
    return () => {
      for (const element of observed.current) element.removeEventListener('scroll', onScroll);
      observed.current.clear();
      stop();
    };
  }, [stop, onScroll]);
  return capture;
}
