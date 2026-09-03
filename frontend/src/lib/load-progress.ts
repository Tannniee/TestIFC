import type { ViewerProgress } from "./viewer-contracts";

const fraction = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? undefined : Math.max(0, Math.min(1, value));

// Overall progress is an estimate by work phase, never a timer or ETA.
export function loadProgressValue(event: ViewerProgress): { overall: number; step: number | undefined } {
  const p = fraction(event.progress);
  const value = p ?? 0;
  switch (event.stage) {
    case "reading": return { overall: 5 * value, step: p };
    case "hashing": return { overall: 5, step: undefined };
    case "cache": return { overall: 8, step: undefined };
    case "converting": {
      // IfcImporter 3.4.7 reports geometry 0..0.60, attributes .60..75,
      // relations .75..90, then completes serialization at 1.
      const ranges = { geometries: [0, .6], attributes: [.6, .75], relations: [.75, .9] };
      const range = event.phase && event.phase in ranges ? ranges[event.phase as keyof typeof ranges] : null;
      return { overall: 10 + 65 * value, step: range && p !== undefined ? fraction((p - range[0]) / (range[1] - range[0])) : undefined };
    }
    case "loading": {
      const stages = { decompressing: [0, .15], parsing: [.15, .35], generating: [.35, 1], done: [1, 1] };
      const range = stages[event.phase as keyof typeof stages] ?? [0, 0];
      return { overall: 75 + 20 * (range[0] + value * (range[1] - range[0])), step: p };
    }
    case "finalizing": return { overall: 95, step: undefined };
    case "ready": return { overall: 100, step: 1 };
    default: return { overall: 0, step: undefined };
  }
}

export function isOpeningModel(event: ViewerProgress | null): boolean {
  return Boolean(event && !["idle", "ready", "error", "cancelled"].includes(event.stage));
}
