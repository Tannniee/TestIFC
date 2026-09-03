import { cubicOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

export function panelMotion(node: HTMLElement, side: "left" | "right"): TransitionConfig {
  const distance = node.getBoundingClientRect().width * (side === "left" ? -1 : 1);
  return {
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 340,
    easing: cubicOut,
    // Animate the overlay only; resizing WebGL on every animation frame stalls IFC rendering.
    css: t => `transform: translate3d(${(1 - t) * distance}px, 0, 0); opacity: ${0.65 + 0.35 * t};`,
  };
}
