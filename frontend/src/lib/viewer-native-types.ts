/** Renderer-neutral values used by the Engine V2 viewer. */
export const SnappingClass = { POINT: 0, LINE: 1, FACE: 2 } as const;
export type SnappingClass = (typeof SnappingClass)[keyof typeof SnappingClass];
export interface ItemData {
  [name: string]: { value: unknown } | ItemData[] | null | undefined;
}
export interface SpatialTreeItem {
  category?: string;
  localId?: number | null;
  children?: SpatialTreeItem[];
}
