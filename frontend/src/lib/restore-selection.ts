import type { ElementRef } from "./workspace-contracts";

interface SelectionIdentitySource {
  getGuids(): Promise<string[]>;
  getLocalIdsByGuids(guids: string[]): Promise<(number | null)[]>;
}

/** Exact artifact IDs remain unambiguous even when an exporter repeats GlobalId. */
export async function resolveViewSelection(model: SelectionIdentitySource, refs: ElementRef[],
  modelHash: string, artifactId: string, check: () => void): Promise<number[]> {
  const owned = refs.filter(ref => ref.modelHash === modelHash);
  const ids = owned.filter(ref => ref.artifactId === artifactId).map(ref => ref.localId);
  const remapped = owned.filter(ref => ref.artifactId !== artifactId && ref.globalId);
  if (!remapped.length) return [...new Set(ids)];

  // Fragments getGuids returns the raw artifact GUID list, including duplicates.
  // Query only on artifact changes, never on ordinary same-artifact view switches.
  const counts = new Map<string, number>();
  for (const guid of await model.getGuids()) counts.set(guid, (counts.get(guid) ?? 0) + 1);
  check();
  const unique = [...new Set(remapped.map(ref => ref.globalId!).filter(guid => counts.get(guid) === 1))];
  if (unique.length) {
    const resolved = await model.getLocalIdsByGuids(unique); check();
    ids.push(...resolved.filter((id): id is number => id !== null));
  }
  return [...new Set(ids)];
}
