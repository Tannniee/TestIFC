export const FRAGMENT_CACHE_VERSION = 2;

export type FragmentMetadataProfile = "full" | "attributes" | "minimum";

export interface FragmentImporterProfileTarget {
  addAllAttributes(): void;
  addAllRelations(): void;
}

export const FRAGMENT_PROFILE_FEATURES: Record<
  FragmentMetadataProfile,
  { allAttributes: boolean; allRelations: boolean }
> = {
  full: { allAttributes: true, allRelations: true },
  attributes: { allAttributes: true, allRelations: false },
  minimum: { allAttributes: false, allRelations: false },
};

export function configureFragmentImporter(
  importer: FragmentImporterProfileTarget,
  profile: FragmentMetadataProfile,
): void {
  const features = FRAGMENT_PROFILE_FEATURES[profile];
  if (features.allAttributes) importer.addAllAttributes();
  if (features.allRelations) importer.addAllRelations();
}

export function resolveFragmentMetadataProfile(
  search: string,
  stored: string | null,
): FragmentMetadataProfile {
  const query = new URLSearchParams(search).get("fragmentProfile");
  for (const candidate of [query, stored]) {
    if (candidate === "full" || candidate === "attributes" || candidate === "minimum") {
      return candidate;
    }
  }
  return "full";
}

export function browserFragmentMetadataProfile(): FragmentMetadataProfile {
  return resolveFragmentMetadataProfile(
    window.location.search,
    window.localStorage.getItem("ifc.fragmentMetadataProfile"),
  );
}

export function fragmentCacheKey(
  modelHash: string,
  profile: FragmentMetadataProfile,
): string {
  return `${modelHash}.fragments-v${FRAGMENT_CACHE_VERSION}-${profile}`;
}
