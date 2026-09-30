import type { FragmentsModel, ItemData, SpatialTreeItem } from "@thatopen/fragments";
import type { BimElementResponse, BrowserView, ModelBrowserResponse, SemanticSearchRequest, SemanticSearchResponse, SemanticFilterRequest, SemanticFilterResponse, SemanticFieldCatalog } from "./api-contracts";
import { bimPropertyGroups, type PropertyGroup } from "./bim-properties.ts";

export interface BrowserNode { id: string; localId: number | null; label: string; children: BrowserNode[];
  ifcType?: string; globalId?: string | null; count?: number; kind?: "element" | "category" | "spatial" | "facet" }
export type { PropertyGroup } from "./bim-properties";
export type PropertyTab = "attributes" | "properties" | "relations" | "materials" | "location";
export interface PropertyResult { groups: PropertyGroup[]; coldStatus?: "not_configured" | "indexing" | "ready" | "error" }
const yieldUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const attr = (item: ItemData, name: string) => { const value = item[name]; return value && !Array.isArray(value) ? value.value : null; };

export class ModelDataService {
  private readonly active: () => FragmentsModel | null;
  private readonly activeHash: () => string;
  private readonly readBim: (expressId: number, modelHash: string) => Promise<BimElementResponse>;
  private readonly readBrowser: (modelHash: string, view: BrowserView) => Promise<ModelBrowserResponse>;
  private readonly readSemantic: (modelHash: string, filter: SemanticSearchRequest) => Promise<SemanticSearchResponse>;
  private readonly readFilter?: (modelHash: string, filter: SemanticFilterRequest) => Promise<SemanticFilterResponse>;
  private readonly readFields?: (modelHash: string) => Promise<SemanticFieldCatalog>;
  private owner: FragmentsModel | null = null;
  private trees = new Map<BrowserView, Promise<BrowserNode[]>>();
  private statuses = new Map<BrowserView, ModelBrowserResponse["coldStatus"]>();
  private properties = new Map<string, Promise<PropertyResult>>();
  private names = new Map<number, string>();
  constructor(
    active: () => FragmentsModel | null,
    activeHash: () => string,
    readBim: (expressId: number, modelHash: string) => Promise<BimElementResponse>,
    readBrowser: (modelHash: string, view: BrowserView) => Promise<ModelBrowserResponse>,
    readSemantic: (modelHash: string, filter: SemanticSearchRequest) => Promise<SemanticSearchResponse>,
    readFilter?: (modelHash: string, filter: SemanticFilterRequest) => Promise<SemanticFilterResponse>,
    readFields?: (modelHash: string) => Promise<SemanticFieldCatalog>,
  ) { this.active = active; this.activeHash = activeHash; this.readBim = readBim;
    this.readBrowser = readBrowser; this.readSemantic = readSemantic; this.readFilter=readFilter; this.readFields=readFields; }
  private model() {
    const model = this.active();
    if (model !== this.owner) { this.clear(); this.owner = model; }
    if (!model) throw new Error("No active IFC");
    return model;
  }
  clear() { this.owner = null; this.trees.clear(); this.statuses.clear(); this.properties.clear(); this.names.clear(); }
  private check(model: FragmentsModel) { if (model !== this.active()) throw new Error("Model query cancelled"); }
  getTree(view: BrowserView = "spatial"): Promise<BrowserNode[]> {
    const model = this.model();
    let tree = this.trees.get(view);
    if (!tree) {
      tree = this.buildTree(model, view).catch(error => { if (this.owner === model) this.trees.delete(view); throw error; });
      this.trees.set(view, tree);
    }
    return tree;
  }
  refreshTree(view: BrowserView) { this.trees.delete(view); return this.getTree(view); }
  getTreeStatus(view: BrowserView) { return this.statuses.get(view) ?? "not_configured"; }
  async getVisibleIds(visible: boolean) {
    const model = this.model();
    const ids = await model.getItemsIdsWithGeometry(); this.check(model);
    const result: number[] = [];
    // Read visibility by element ID: shared geometry can make the aggregate
    // getItemsByVisibility response include a hidden occurrence.
    for (let start = 0; start < ids.length; start += 1000) {
      const batch = ids.slice(start, start + 1000);
      const flags = await model.getVisible(batch); this.check(model);
      batch.forEach((id, index) => { if (flags[index] === visible) result.push(id); });
    }
    return result;
  }
  async searchSemantic(filter: SemanticSearchRequest) {
    const model = this.model(), hash = this.activeHash();
    const result = await this.readSemantic(hash, filter); this.check(model);
    if (result.modelHash !== hash) throw new Error("Model semantic query cancelled");
    return result;
  }
  async getSemanticFields() {
    const model=this.model(), hash=this.activeHash();
    if(!this.readFields)throw new Error("BIM field catalog unavailable");
    const result=await this.readFields(hash);this.check(model);
    if(result.modelHash!==hash)throw new Error("Model semantic query cancelled");
    return result;
  }
  async searchAllSemantic(filter: SemanticFilterRequest, progress: (loaded: number,total: number)=>void, cancelled: ()=>boolean) {
    const model=this.model(),hash=this.activeHash();
    if(!this.readFilter)throw new Error("Compound BIM filtering unavailable");
    const results: SemanticFilterResponse["results"]=[],seen=new Set<number>();let cursor=0,total:number|undefined;
    for(;;) {
      if(cancelled())throw new Error("BIM query cancelled");
      const page=await this.readFilter(hash,{...filter,cursor,limit:500});this.check(model);
      if(cancelled()||page.modelHash!==hash)throw new Error("BIM query cancelled");
      if(page.coldStatus!=="ready")return {...page,results:[],selectableIds:[] as number[]};
      if(total!==undefined&&page.total!==total)throw new Error("BIM result changed; retry query");total=page.total;
      for(const item of page.results){if(!seen.has(item.localId)){seen.add(item.localId);results.push(item);}}
      progress(results.length,total);
      if(page.nextCursor===null) {
        if(results.length!==total)throw new Error("Incomplete BIM result; retry query");
        const geometry=await model.getItemsIdsWithGeometry();this.check(model);
        if(cancelled())throw new Error("BIM query cancelled");
        const renderable=new Set(geometry);
        return {...page,results,truncated:false,selectableIds:results.filter(item=>renderable.has(item.localId)).map(item=>item.localId)};
      }
      if(!Number.isSafeInteger(page.nextCursor)||page.nextCursor<=cursor)throw new Error("Invalid BIM page cursor");
      cursor=page.nextCursor;await yieldUI();
    }
  }
  private async buildTree(model: FragmentsModel, view: BrowserView): Promise<BrowserNode[]> {
    let snapshot: ModelBrowserResponse | null = null;
    const modelHash = this.activeHash();
    try {
      snapshot = await this.readBrowser(modelHash, view); this.check(model);
      if (snapshot.modelHash !== modelHash || snapshot.view !== view) throw new Error("Model browser query cancelled");
      this.statuses.set(view, snapshot.coldStatus);
    }
    catch (error) {
      if (view !== "spatial" || !(error && typeof error === "object" && "message" in error && error.message === "index_preparing")) throw error;
      this.statuses.set(view, "indexing");
    }
    if (view !== "spatial") return buildFacetTree(snapshot!);
    const structure = await model.getSpatialStructure(); this.check(model);
    const root: BrowserNode[] = [];
    const contained = new Set<number>();
    const queue: Array<{ item: SpatialTreeItem; target: BrowserNode[]; path: string }> = [{ item: structure, target: root, path: "model" }];
    let count = 0;
    while (queue.length) {
      const {item,target,path} = queue.pop()!;
      if (!item) continue;
      const node: BrowserNode = { id: `${path}/${item.localId ?? item.category ?? "root"}`, localId: item.localId ?? null,
        label: `${item.category ?? "Model"}${item.localId != null ? ` #${item.localId}` : ""}`, children: [],
        ifcType: item.category ?? undefined, kind: "spatial" };
      target.push(node);
      if (node.localId !== null) contained.add(node.localId);
      const children = item.children ?? [];
      for (let i = children.length-1; i >= 0; i--) queue.push({ item: children[i], target: node.children, path: node.id });
      if (++count % 1000 === 0) { await yieldUI(); this.check(model); }
    }
    if (root.length === 1 && root[0].localId === null && root[0].children.length === 0) {
      const categories = await model.getItemsOfCategories([/.*/]); this.check(model); root.length = 0;
      for (const [category, ids] of Object.entries(categories)) {
        root.push({ id: `category/${category}`, localId: null, label: category, kind: "category", count: ids.length,
          children: ids.map(localId => ({ id: `${category}/${localId}`, localId, label: `${category} #${localId}`, ifcType: category, kind: "element", children: [] })) });
      }
    } else {
      const ids = await model.getItemsIdsWithGeometry(); this.check(model);
      const missing = ids.filter(id => !contained.has(id));
      if (missing.length) root.push({id:"uncontained",localId:null,label:"Uncontained",kind:"category",count:missing.length,children:missing.map(localId=>({
        id:`uncontained/${localId}`,localId,label:`Element #${localId}`,kind:"element",children:[] }))});
    }
    if (snapshot) enrichSpatialTree(root, snapshot);
    groupSpatialCategories(root);
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

const CATEGORY_LABELS: Record<string, string> = {
  IfcWall: "Walls", IfcWallStandardCase: "Walls", IfcDoor: "Doors", IfcBeam: "Beams",
  IfcColumn: "Columns", IfcSlab: "Slabs", IfcWindow: "Windows", IfcRoof: "Roofs",
  IfcStair: "Stairs", IfcSpace: "Spaces", IfcPipeSegment: "Pipe segments",
  IfcDuctSegment: "Duct segments", IfcBuildingElementProxy: "Proxies",
};
const categoryLabel = (ifcType: string) => CATEGORY_LABELS[ifcType] ?? `${ifcType.replace(/^Ifc/, "")}s`;

function enrichSpatialTree(root: BrowserNode[], snapshot: ModelBrowserResponse) {
  const elements = new Map(snapshot.elements.map(item => [item.localId, item]));
  const stack = [...root];
  while (stack.length) {
    const node = stack.pop()!;
    const item = node.localId === null ? null : elements.get(node.localId);
    if (item) {
      node.ifcType = item.ifcType; node.globalId = item.globalId;
      node.label = item.name || `${item.ifcType} #${item.localId}`;
      node.kind = "element";
    }
    stack.push(...node.children);
  }
}

function groupSpatialCategories(root: BrowserNode[]) {
  const stack = [...root];
  while (stack.length) {
    const node = stack.pop()!;
    stack.push(...node.children);
    if (node.ifcType !== "IfcBuildingStorey" && node.id !== "uncontained") continue;
    const groups = new Map<string, BrowserNode[]>();
    const other: BrowserNode[] = [];
    for (const child of node.children) {
      if (child.kind !== "element" || child.localId === null) { other.push(child); continue; }
      const type = child.ifcType || "IfcProduct";
      const label = categoryLabel(type);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(child);
    }
    const categories = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, children]) => ({
      id: `${node.id}/category/${label}`, localId: null, label,
      kind: "category" as const, count: children.length, children,
    }));
    node.children = [...other, ...categories];
  }
}

export function buildFacetTree(snapshot: ModelBrowserResponse): BrowserNode[] {
  const elements = new Map(snapshot.elements.map(item => [item.localId, item]));
  const groups = new Map<string, BrowserNode>();
  const assigned = new Set<number>();
  for (const facet of snapshot.facets) {
    const item = elements.get(facet.localId);
    if (!item) continue;
    const groupId = `${snapshot.view}/${facet.key}`;
    let group = groups.get(groupId);
    if (!group) {
      group = { id: groupId, localId: null, label: facet.label, kind: "facet", children: [] };
      groups.set(groupId, group);
    }
    group.children.push({ id: `${groupId}/${item.localId}`, localId: item.localId,
      label: item.name || `${item.ifcType} #${item.localId}`, ifcType: item.ifcType,
      globalId: item.globalId, kind: "element", children: [] });
    assigned.add(item.localId);
  }
  const result = [...groups.values()].map(group => ({ ...group, count: group.children.length }));
  const unassigned = snapshot.elements.filter(item => !assigned.has(item.localId));
  if (unassigned.length) result.push({ id: `${snapshot.view}/unassigned`, localId: null,
    label: "Unassigned", kind: "facet", count: unassigned.length,
    children: unassigned.map(item => ({ id: `${snapshot.view}/unassigned/${item.localId}`,
      localId: item.localId, label: item.name || `${item.ifcType} #${item.localId}`,
      ifcType: item.ifcType, globalId: item.globalId, kind: "element", children: [] })) });
  return result;
}

export function descendantIds(node: BrowserNode): number[] {
  const result = new Set<number>(), stack = [node];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.localId !== null && item.kind === "element") result.add(item.localId);
    stack.push(...item.children);
  }
  return [...result];
}

export function filterBrowserTree(nodes: BrowserNode[], query: string, ifcType: string,
  scope: "all" | "visible" | "selected", allowedIds: Set<number> | null,
  semanticIds: Set<number> | null = null): BrowserNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle && !ifcType && scope === "all" && !semanticIds) return nodes;
  const filter = (node: BrowserNode): BrowserNode | null => {
    if (!node.children.length) {
      if (node.kind !== "element" || node.localId === null) return null;
      if (ifcType && node.ifcType !== ifcType) return null;
      if (scope !== "all" && !allowedIds?.has(node.localId)) return null;
      if (semanticIds && !semanticIds.has(node.localId)) return null;
      if (needle && ![node.label, node.globalId, node.ifcType].some(value => value?.toLocaleLowerCase().includes(needle))) return null;
      return node;
    }
    const children = node.children.map(filter).filter((item): item is BrowserNode => item !== null);
    const ownMatch = node.kind === "element" && node.localId !== null
      && (!ifcType || node.ifcType === ifcType)
      && (scope === "all" || allowedIds?.has(node.localId))
      && (!semanticIds || semanticIds.has(node.localId))
      && (!needle || [node.label, node.globalId, node.ifcType].some(value => value?.toLocaleLowerCase().includes(needle)));
    return children.length || ownMatch ? { ...node, children, count: node.kind === "category" || node.kind === "facet" ? children.length : node.count } : null;
  };
  return nodes.map(filter).filter((item): item is BrowserNode => item !== null);
}

export function visibleTreeRows(nodes: BrowserNode[], expanded: Set<string>): Array<{ node: BrowserNode; depth: number }> {
  const rows: Array<{ node: BrowserNode; depth: number }> = [];
  const stack = [...nodes].reverse().map(node => ({node,depth:0}));
  while(stack.length) { const row=stack.pop()!; rows.push(row); if(expanded.has(row.node.id)) for(let i=row.node.children.length-1;i>=0;i--) stack.push({node:row.node.children[i],depth:row.depth+1}); }
  return rows;
}
