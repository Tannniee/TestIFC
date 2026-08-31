import { ifcCategoryMap, type ItemData } from "@thatopen/fragments";
import type { SelectionPayload } from "./api";
import type { ViewerSelection } from "./viewer-contracts";

function attributeValue(item: ItemData | null, name: string): unknown {
  const attribute = item?.[name];
  if (Array.isArray(attribute) || attribute == null) return null;
  if (typeof attribute === "object" && "value" in attribute) return attribute.value;
  return null;
}

function textAttribute(item: ItemData | null, ...names: string[]): string | null {
  for (const name of names) {
    const value = attributeValue(item, name);
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return null;
}

function categoryName(item: ItemData | null): string | null {
  const value = attributeValue(item, "_category");
  if (typeof value === "number") return ifcCategoryMap[value] ?? String(value);
  if (typeof value === "string") return value;
  return textAttribute(item, "type", "Type");
}

function flattenPreview(item: ItemData | null): Record<string, unknown> {
  if (!item) return {};
  const preview: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(item)) {
    if (Array.isArray(raw) || raw == null) continue;
    if (typeof raw === "object" && "value" in raw) {
      const value = raw.value;
      if (["string", "number", "boolean"].includes(typeof value)) preview[key] = value;
    } else if (["string", "number", "boolean"].includes(typeof raw)) {
      preview[key] = raw;
    }
  }
  return preview;
}

export function createViewerSelection(
  modelId: string,
  modelName: string,
  localId: number,
  item: ItemData | null,
  guid: string | null,
): ViewerSelection {
  return {
    modelId,
    modelName,
    globalId: guid,
    expressId: localId,
    localId,
    ifcType: categoryName(item),
    objectType: textAttribute(item, "ObjectType"),
    description: textAttribute(item, "Description"),
    name: textAttribute(item, "Name", "LongName"),
    raw: item,
  };
}

export function createSelectionPayload(selection: ViewerSelection): SelectionPayload {
  return {
    schemaVersion: 1,
    source: "thatopen",
    model: { id: selection.modelId, name: selection.modelName, path: null },
    element: {
      globalId: selection.globalId,
      expressId: selection.expressId,
      localId: selection.localId,
      ifcType: selection.ifcType,
      objectType: selection.objectType,
      description: selection.description,
      name: selection.name,
    },
    selection: { status: "selected", selectedAt: new Date().toISOString() },
    preview: flattenPreview(selection.raw),
  };
}
