import { ifcCategoryMap, RenderedFaces, type FragmentsModel, type ItemData } from "@thatopen/fragments";
import * as THREE from "three";
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

export class ViewerHighlights {
  private single: { model: FragmentsModel; localId: number } | null = null;
  private multiple: { model: FragmentsModel; localIds: number[] } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private run(action: () => Promise<void>) {
    const task = this.queue.then(action); this.queue = task.catch(() => {}); return task;
  }
  drain() { return this.queue; }
  get localIds() { return this.multiple?.localIds ?? (this.single ? [this.single.localId] : []); }

  get hasMultiple() {
    return Boolean(this.multiple?.localIds.length);
  }

  async clear() {
    return this.run(async () => {
      if (this.single) await this.single.model.resetHighlight([this.single.localId]);
      if (this.multiple) await this.multiple.model.resetHighlight(this.multiple.localIds);
      this.single = null;
      this.multiple = null;
    });
  }

  async setSingle(model: FragmentsModel, localId: number) {
    return this.run(async () => { await model.highlight([localId], this.material()); this.single = { model, localId }; });
  }

  async setMultiple(model: FragmentsModel, localIds: number[]) {
    return this.run(async () => { await model.highlight(localIds, this.material()); this.multiple = { model, localIds: [...localIds] }; });
  }

  private material() {
    return {
      color: new THREE.Color(0x2d8cff),
      renderedFaces: RenderedFaces.TWO,
      opacity: 1,
      transparent: false,
    };
  }
}
