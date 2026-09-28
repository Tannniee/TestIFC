import type { FragmentsModel, ItemData, SpatialTreeItem } from "@thatopen/fragments";
import type { BimElementResponse } from "./api-contracts";
import { bimPropertyGroups, type PropertyGroup } from "./bim-properties.ts";

export interface BrowserNode { id: string; localId: number | null; label: string; children: BrowserNode[] }
export type { PropertyGroup } from "./bim-properties";
export type PropertyTab = "attributes" | "properties" | "relations" | "materials" | "location";
export interface PropertyResult { groups: PropertyGroup[]; coldStatus?: "not_configured" | "indexing" | "ready" | "error" }
const yieldUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const attr = (item: ItemData, name: string) => { const value = item[name]; return value && !Array.isArray(value) ? value.value : null; };

export class ModelDataService {
  private readonly active: () => FragmentsModel | null;
  private readonly activeHash: () => string;
  private readonly readBim: (expressId: number, modelHash: string) => Promise<BimElementResponse>;
  private owner: FragmentsModel | null = null;
  private tree: Promise<BrowserNode[]> | null = null;
  private properties = new Map<string, Promise<PropertyResult>>();
  private names = new Map<number, string>();
  constructor(
    active: () => FragmentsModel | null,
    activeHash: () => string,
    readBim: (expressId: number, modelHash: string) => Promise<BimElementResponse>,
  ) { this.active = active; this.activeHash = activeHash; this.readBim = readBim; }
  private model() {
    const model = this.active();
    if (model !== this.owner) { this.clear(); this.owner = model; }
    if (!model) throw new Error("No active IFC");
    return model;
  }
  clear() { this.owner = null; this.tree = null; this.properties.clear(); this.names.clear(); }
  private check(model: FragmentsModel) { if (model !== this.active()) throw new Error("Model query cancelled"); }
  getTree(): Promise<BrowserNode[]> {
    const model = this.model();
    if (!this.tree) this.tree = this.buildTree(model).catch(error => { if (this.owner === model) this.tree = null; throw error; });
    return this.tree;
  }
  private async buildTree(model: FragmentsModel): Promise<BrowserNode[]> {
    const structure = await model.getSpatialStructure(); this.check(model);
    const root: BrowserNode[] = [];
    const contained = new Set<number>();
    const queue: Array<{ item: SpatialTreeItem; target: BrowserNode[]; path: string }> = [{ item: structure, target: root, path: "model" }];
    let count = 0;
    while (queue.length) {
      const {item,target,path} = queue.pop()!;
      if (!item) continue;
      const node: BrowserNode = { id: `${path}/${item.localId ?? item.category ?? "root"}`, localId: item.localId ?? null,
        label: `${item.category ?? "Model"}${item.localId != null ? ` #${item.localId}` : ""}`, children: [] };
      target.push(node);
      if (node.localId !== null) contained.add(node.localId);
      const children = item.children ?? [];
      for (let i = children.length-1; i >= 0; i--) queue.push({ item: children[i], target: node.children, path: node.id });
      if (++count % 1000 === 0) { await yieldUI(); this.check(model); }
    }
    if (root.length === 1 && root[0].localId === null && root[0].children.length === 0) {
      const categories = await model.getItemsOfCategories([/.*/]); this.check(model); root.length = 0;
      for (const [category, ids] of Object.entries(categories)) {
        root.push({ id: `category/${category}`, localId: null, label: category,
          children: ids.map(localId => ({ id: `${category}/${localId}`, localId, label: `${category} #${localId}`, children: [] })) });
      }
    } else {
      const ids = await model.getItemsIdsWithGeometry(); this.check(model);
      const missing = ids.filter(id => !contained.has(id));
      if (missing.length) root.push({id:"uncontained",localId:null,label:"Uncontained elements",children:missing.map(localId=>({
        id:`uncontained/${localId}`,localId,label:`Element #${localId}`,children:[] }))});
    }
    return root;
  }
  async getNames(ids: number[]) {
    const model = this.model();
    const missing = [...new Set(ids)].filter(id => !this.names.has(id));
    for (let i=0;i<missing.length;i+=80) {
      const batch = missing.slice(i,i+80);
      const items = await model.getItemsData(batch, { attributesDefault: false, attributes: ["Name", "LongName"] }); this.check(model);
      batch.forEach((id,j) => this.names.set(id, items[j] ? String(attr(items[j],"Name") ?? attr(items[j],"LongName") ?? "") : ""));
    }
    return Object.fromEntries(ids.map(id => [id,this.names.get(id) ?? ""]));
  }
  getProperties(localId: number, group: PropertyTab): Promise<PropertyResult> {
    const model = this.model(), key = `${localId}:${group}`;
    const existing = this.properties.get(key); if (existing) return existing;
    const request = (async () => {
      if (group === "properties" || group === "relations") {
        let result;
        const modelHash = this.activeHash();
        try { result = await this.readBim(localId, modelHash); }
        catch (error) {
          if (error && typeof error === "object" && "status" in error && "message" in error
            && error.status === 409 && error.message === "index_preparing") {
            this.check(model);
            return { groups: [], coldStatus: "indexing" } as PropertyResult;
          }
          throw error;
        }
        this.check(model);
        if (result.modelHash !== modelHash) throw new Error("Model query cancelled");
        return { groups: bimPropertyGroups(result.element, group), coldStatus: result.coldStatus } as PropertyResult;
      }
      const relationNames = group === "materials" ? ["HasAssociations", "RelatingMaterial", "ForLayerSet", "MaterialLayers", "Material"]
          : group === "location" ? ["ContainedInStructure", "Decomposes"] : [];
      const relations = Object.fromEntries(relationNames.map(name => [name, { attributes: true, relations: true }]));
      const items = await model.getItemsData([localId], { attributesDefault: true,
        relationsDefault: { attributes: false, relations: false }, relations });
      this.check(model);
      const groups: PropertyGroup[] = []; const seen = new Set<object>();
      const visit = (item: ItemData, name: string, depth: number) => {
        if (depth > 5 || groups.length >= 60 || seen.has(item)) return; seen.add(item);
        const rows: PropertyGroup["rows"] = [];
        for (const [key,value] of Object.entries(item)) {
          if (Array.isArray(value)) { for (const child of value) visit(child, `${key} · ${attr(child,"Name") ?? ""}`,depth+1); }
          else if (value?.value != null && !key.startsWith("_")) rows.push({ name: key, value: String(value.value) });
        }
        if (rows.length) groups.push({ name, rows });
      };
      for (const item of items) visit(item, "Attributes",0);
      return { groups };
    })().then(result => {
      if (this.owner === model && result.coldStatus && result.coldStatus !== "ready") this.properties.delete(key);
      return result;
    }).catch(error => { if (this.owner === model) this.properties.delete(key); throw error; });
    this.properties.set(key,request);
    if (this.properties.size > 64) this.properties.delete(this.properties.keys().next().value!);
    return request;
  }
}

export function visibleTreeRows(nodes: BrowserNode[], expanded: Set<string>): Array<{ node: BrowserNode; depth: number }> {
  const rows: Array<{ node: BrowserNode; depth: number }> = [];
  const stack = [...nodes].reverse().map(node => ({node,depth:0}));
  while(stack.length) { const row=stack.pop()!; rows.push(row); if(expanded.has(row.node.id)) for(let i=row.node.children.length-1;i>=0;i--) stack.push({node:row.node.children[i],depth:row.depth+1}); }
  return rows;
}
