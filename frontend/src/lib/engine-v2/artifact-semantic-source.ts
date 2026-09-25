import type { ItemData, SpatialTreeItem } from "../viewer-native-types";
import type { EngineV2ArtifactTransport } from "./artifact-reader.ts";
import { validateEngineV2ChunkHeader } from "./chunk-header.ts";
import { engineV2Chunk, type EngineV2Manifest } from "./manifest.ts";
import type { EngineV2SemanticSource } from "./engine-v2-model.ts";

const HEADER_BYTES = 32;
const CORE_RECORD_BYTES = 48;
const DEEP_INDEX_RECORD_BYTES = 24;
const REPRESENTED_PRODUCT = 1;

type Attribute = { value: unknown };
type NativeRecord = {
  expressId: number;
  parentId: number;
  type: string;
  represented: boolean;
  globalId: string;
  name: string;
  description: string;
  objectType: string;
};
type DeepSlice = { offset: number; length: number };
type DeepRecord = {
  type?: unknown;
  material?: unknown;
  properties?: unknown;
  quantities?: unknown;
  classifications?: unknown;
  units?: unknown;
};

function attribute(value: unknown): Attribute { return { value }; }

function coreItemData(record: NativeRecord | undefined): ItemData {
  if (!record) return {} as ItemData;
  return {
    expressID: attribute(record.expressId),
    _category: attribute(record.type),
    GlobalId: attribute(record.globalId || null),
    Name: attribute(record.name || null),
    ObjectType: attribute(record.objectType || null),
    Description: attribute(record.description || null),
  } as unknown as ItemData;
}

function nestedRecord(name: string, value: unknown): ItemData {
  const item: Record<string, Attribute | ItemData[]> = { Name: attribute(name) };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      item[key] = child && typeof child === "object"
        ? Array.isArray(child)
          ? child.map((entry, index) => nestedRecord(`${key} ${index + 1}`, entry))
          : [nestedRecord(key, child)]
        : attribute(child);
    }
  } else item.Value = attribute(value);
  return item as unknown as ItemData;
}

function mergeDeep(item: ItemData, record: DeepRecord): ItemData {
  const target = item as unknown as Record<string, Attribute | ItemData[]>;
  const groups: Array<[string, unknown]> = [
    ["IsTypedBy", record.type],
    ["HasAssociations", record.material],
    ["IsDefinedBy", record.properties],
    ["Quantities", record.quantities],
    ["Classifications", record.classifications],
    ["Units", record.units],
  ];
  for (const [name, value] of groups) {
    if (value == null) continue;
    if (Array.isArray(value)) target[name] = value.map((child, index) => nestedRecord(`${name} ${index + 1}`, child));
    else if (typeof value === "object") target[name] = Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => nestedRecord(key, child));
    else target[name] = [nestedRecord(name, value)];
  }
  return item;
}

function wantsRelations(config?: Record<string, unknown>) {
  const relations = config?.relations;
  return Boolean(relations && typeof relations === "object" && Object.keys(relations).length);
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Engine V2 deep semantic payload is not an object");
  return value as Record<string, unknown>;
}

/** Artifact-native hierarchy, identity, properties, quantities, materials, and classifications. */
export class ArtifactEngineV2SemanticSource implements EngineV2SemanticSource {
  private readonly artifactKey: string;
  private readonly manifest: EngineV2Manifest;
  private readonly transport: EngineV2ArtifactTransport;
  private readonly controller = new AbortController();
  private coreLoading: Promise<void> | null = null;
  private deepLoading: Promise<void> | null = null;
  private records = new Map<number, NativeRecord>();
  private byGuid = new Map<string, number>();
  private roots: NativeRecord[] = [];
  private deep = new Map<number, DeepSlice>();

  constructor(
    artifactKey: string,
    manifest: EngineV2Manifest,
    transport: EngineV2ArtifactTransport,
  ) {
    this.artifactKey = artifactKey;
    this.manifest = manifest;
    this.transport = transport;
  }

  private coreReady() {
    this.coreLoading ??= this.loadCore().catch(error => { this.coreLoading = null; throw error; });
    return this.coreLoading;
  }

  private deepReady() {
    this.deepLoading ??= this.loadDeepIndex().catch(error => { this.deepLoading = null; throw error; });
    return this.deepLoading;
  }

  private async loadCore() {
    const recordDescriptor = engineV2Chunk(this.manifest, "semantic-records.ifcv2");
    const stringDescriptor = engineV2Chunk(this.manifest, "semantic-strings.ifcv2");
    const [recordBuffer, stringBuffer] = await Promise.all([
      this.transport.getChunk(this.artifactKey, "semantic-records.ifcv2", this.controller.signal),
      this.transport.getChunk(this.artifactKey, "semantic-strings.ifcv2", this.controller.signal),
    ]);
    validateEngineV2ChunkHeader(new Uint8Array(recordBuffer, 0, HEADER_BYTES), recordDescriptor, recordBuffer.byteLength);
    validateEngineV2ChunkHeader(new Uint8Array(stringBuffer, 0, HEADER_BYTES), stringDescriptor, stringBuffer.byteLength);
    const view = new DataView(recordBuffer);
    const strings = new Uint8Array(stringBuffer, HEADER_BYTES);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const readString = (offset: number) => {
      const start = view.getUint32(offset, true);
      const length = view.getUint32(offset + 4, true);
      if (start + length > strings.byteLength) throw new Error("Engine V2 semantic string is outside the string table");
      return length ? decoder.decode(strings.subarray(start, start + length)) : "";
    };
    const records = new Map<number, NativeRecord>();
    const byGuid = new Map<string, number>();
    let represented = 0;
    for (let index = 0; index < this.manifest.semantic.records; index++) {
      const offset = HEADER_BYTES + index * CORE_RECORD_BYTES;
      const expressId = view.getInt32(offset, true);
      const parentId = view.getInt32(offset + 4, true);
      const typeId = view.getUint16(offset + 8, true);
      const flags = view.getUint16(offset + 10, true);
      const type = this.manifest.typeNames[typeId];
      if (!type || expressId <= 0 || records.has(expressId)) throw new Error("Engine V2 semantic record identity is invalid");
      const record: NativeRecord = {
        expressId, parentId, type, represented: Boolean(flags & REPRESENTED_PRODUCT),
        globalId: readString(offset + 12), name: readString(offset + 20),
        description: readString(offset + 28), objectType: readString(offset + 36),
      };
      if (record.represented) represented++;
      if (record.globalId) {
        if (byGuid.has(record.globalId)) throw new Error("Engine V2 semantic GlobalId is duplicated");
        byGuid.set(record.globalId, expressId);
      }
      records.set(expressId, record);
    }
    if (represented !== this.manifest.semantic.representedProducts) throw new Error("Engine V2 semantic product coverage drifted");
    this.records = records;
    this.byGuid = byGuid;
    this.roots = [...records.values()].filter(record => !record.parentId || !records.has(record.parentId));
    if (this.roots.length !== this.manifest.semantic.roots) throw new Error("Engine V2 semantic root coverage drifted");
  }

  private async loadDeepIndex() {
    const descriptor = engineV2Chunk(this.manifest, "semantic-deep-index.ifcv2");
    const buffer = await this.transport.getChunk(this.artifactKey, "semantic-deep-index.ifcv2", this.controller.signal);
    validateEngineV2ChunkHeader(new Uint8Array(buffer, 0, HEADER_BYTES), descriptor, buffer.byteLength);
    const view = new DataView(buffer);
    const deep = new Map<number, DeepSlice>();
    let previousId = 0;
    for (let index = 0; index < this.manifest.semantic.deep.records; index++) {
      const at = HEADER_BYTES + index * DEEP_INDEX_RECORD_BYTES;
      const expressId = view.getInt32(at, true);
      const flags = view.getUint32(at + 4, true);
      const rawOffset = view.getBigUint64(at + 8, true);
      const length = view.getUint32(at + 16, true);
      const reserved = view.getUint32(at + 20, true);
      if (rawOffset > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Engine V2 deep semantic offset is too large");
      const offset = Number(rawOffset);
      if (expressId <= previousId || flags || reserved || !length || length > this.manifest.semantic.deep.maximumRecordBytes ||
          offset + length > this.manifest.semantic.deep.valueBytes) {
        throw new Error("Engine V2 deep semantic index is invalid");
      }
      previousId = expressId;
      deep.set(expressId, { offset, length });
    }
    if (deep.size !== this.manifest.semantic.representedProducts) throw new Error("Engine V2 deep semantic product coverage drifted");
    this.deep = deep;
  }

  private async deepRecord(expressId: number): Promise<DeepRecord> {
    await this.deepReady();
    const slice = this.deep.get(expressId);
    if (!slice) return {};
    const bytes = await this.transport.getChunkRange(
      this.artifactKey,
      "semantic-deep-values.ifcv2",
      HEADER_BYTES + slice.offset,
      slice.length,
      this.controller.signal,
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return objectRecord(JSON.parse(text)) as DeepRecord;
  }

  async getSpatialStructure(): Promise<SpatialTreeItem> {
    await this.coreReady();
    const nodes = new Map<number, SpatialTreeItem>();
    for (const record of this.records.values()) nodes.set(record.expressId, {
      category: record.name || record.type,
      localId: record.expressId,
      children: [],
    });
    for (const record of this.records.values()) {
      const parent = nodes.get(record.parentId);
      if (parent) {
        parent.children ??= [];
        parent.children.push(nodes.get(record.expressId)!);
      }
    }
    return { category: "Model", localId: null, children: this.roots.map(record => nodes.get(record.expressId)!) };
  }

  async getItemsData(ids: number[], config?: Record<string, unknown>): Promise<ItemData[]> {
    await this.coreReady();
    const items = ids.map(id => coreItemData(this.records.get(id)));
    if (!wantsRelations(config)) return items;
    const deep = await Promise.all(ids.map(id => this.deepRecord(id)));
    return items.map((item, index) => mergeDeep(item, deep[index]));
  }

  async getGuidsByLocalIds(ids: number[]) {
    await this.coreReady();
    return ids.map(id => this.records.get(id)?.globalId || null);
  }

  async getLocalIdsByGuids(guids: string[]) {
    await this.coreReady();
    return guids.map(guid => this.byGuid.get(guid) ?? null);
  }

  async getGuids() {
    await this.coreReady();
    return [...this.byGuid.keys()];
  }

  async getItemsOfCategories(categories: RegExp[]) {
    await this.coreReady();
    const result: Record<string, number[]> = {};
    for (const record of this.records.values()) {
      if (!categories.some(pattern => { pattern.lastIndex = 0; return pattern.test(record.type); })) continue;
      (result[record.type] ??= []).push(record.expressId);
    }
    return result;
  }

  dispose() {
    this.controller.abort(new DOMException("Engine V2 semantic source disposed", "AbortError"));
    this.records.clear();
    this.byGuid.clear();
    this.roots = [];
    this.deep.clear();
  }
}
