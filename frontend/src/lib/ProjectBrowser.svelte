<script lang="ts">
  import BimFilter from "./BimFilter.svelte";
  import { onDestroy } from "svelte";
  import { activeDocument, activeView, type WorkspaceState } from "./workspace-contracts";
  import { descendantIds, filterBrowserTree, visibleTreeRows, type BrowserNode, type ModelDataService } from "./model-data-service";
  import type { BrowserView } from "./api-contracts";
  export let open = true;
  export let locale: "vi" | "en" = "vi";
  export let state: WorkspaceState;
  export let modelKey: string;
  export let activeModelHash: string;
  export let service: ModelDataService;
  export let onView: (id: string) => void;
  export let onSelect: (ids: number[]) => Promise<void>;
  export let onAction: (action: "hide" | "isolate" | "fit" | "showAll" | "properties", ids: number[]) => Promise<void>;
  export let onExpanded: (ids: string[]) => void;
  export let onClose: () => void;
  export let onResize: (event: PointerEvent) => void;
  let owner = "", request = 0, root: BrowserNode[] | null = null, loading = false, error = "";
  let treeRequested = false, autoLoadOwner = "";
  let expanded = new Set<string>(), names: Record<number,string> = {}, scrollTop = 0, nameKey = "";
  let viewMode: BrowserView = "spatial", search = "", ifcType = "", scope: "all" | "visible" | "selected" = "all";
  let visibleIds = new Set<number>(), hiddenIds = new Set<number>();
  let coldStatus = "not_configured";
  let menu: { x: number; y: number; node: BrowserNode } | null = null;
  let semanticHits: Set<number> | null = null, filterReset=0;
  let treeHost: HTMLDivElement, panelHost: HTMLElement;
  onDestroy(() => { request++; });
  $: doc = activeDocument(state);
  $: view = activeView(state);
  $: modelReady = !state.busy && !!doc && !!activeModelHash && doc.modelHash === activeModelHash;
  $: selected = new Set(view?.state.selection.map(ref => ref.localId) ?? []);
  $: if (owner !== modelKey) {
    owner = modelKey; request++; root = null; loading = false; error = ""; names = {}; nameKey = ""; scrollTop = 0;
    visibleIds = new Set(); hiddenIds = new Set();
    viewMode = "spatial"; search = ""; ifcType = ""; scope = "all"; menu = null; coldStatus = "not_configured";
    semanticHits = null;
    expanded = new Set(doc?.expandedNodes ?? []);
  }
  $: if (open && modelReady && treeRequested && autoLoadOwner !== owner) {
    autoLoadOwner = owner;
    void loadTree();
  }
  $: allowedIds = scope === "selected" ? selected : scope === "visible" ? visibleIds : null;
  $: effectiveSemanticHits = semanticHits;
  $: filtered = open ? filterBrowserTree(root ?? [], search, ifcType, scope, allowedIds, effectiveSemanticHits) : [];
  $: filterActive = !!(search.trim() || ifcType || scope !== "all" || effectiveSemanticHits);
  $: displayExpanded = filterActive ? new Set([...expanded, ...branchIds(filtered)]) : expanded;
  $: rows = visibleTreeRows(filtered, displayExpanded);
  $: eligibleIds = semanticHits && root ? new Set(filtered.flatMap(descendantIds)) : null;
  $: typeOptions = [...new Set((root ?? []).flatMap(collectTypes))].sort();
  $: start = Math.max(0,Math.floor(scrollTop/28)-5);
  $: visible = rows.slice(start,start+50);
  $: nextNames = `${owner}:${visible.map(r => r.node.localId).join(",")}`;
  $: if (open && root && !state.busy && nextNames !== nameKey) { nameKey = nextNames; void loadNames(visible.map(r=>r.node.localId).filter((id): id is number => id !== null)); }
  async function loadNames(ids: number[]) {
    const current = request;
    try { const result = await service.getNames(ids); if (current === request) names = { ...names,...result }; }
    catch (failure) { if (current === request && matchesActiveModel()) error = String(failure); }
  }
  async function loadTree(force = false) {
    if (loading || !matchesActiveModel()) return;
    const current = ++request, expectedOwner = owner; loading = true; error = "";
    try { const result = await (force ? service.refreshTree(viewMode) : service.getTree(viewMode)); if (current === request && owner === expectedOwner && matchesActiveModel()) {
      root=result; expanded = viewMode === "spatial" && expanded.size ? expanded : new Set(result.slice(0, viewMode === "spatial" ? 1 : 0).map(n=>n.id));
      coldStatus = service.getTreeStatus(viewMode);
      void refreshVisibility();
    } }
    catch (failure) { if (current === request && owner === expectedOwner && matchesActiveModel()) error=String(failure); }
    finally { if(current===request) loading=false; }
  }
  function matchesActiveModel() {
    const currentDoc = activeDocument(state);
    return !state.busy && !!currentDoc && !!activeModelHash && currentDoc.modelHash === activeModelHash;
  }
  function openTree() { treeRequested = true; autoLoadOwner = owner; void loadTree(true); }
  function collectTypes(node: BrowserNode): string[] {
    const own = node.kind === "element" && node.ifcType ? [node.ifcType] : [];
    return [...own, ...node.children.flatMap(collectTypes)];
  }
  function branchIds(nodes: BrowserNode[]): string[] {
    const ids: string[] = [], stack = [...nodes];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.children.length) { ids.push(node.id); stack.push(...node.children); }
    }
    return ids;
  }
  async function refreshVisibility() {
    const current = request;
    try {
      const hidden = new Set(await service.getVisibleIds(false));
      if (current === request && matchesActiveModel()) { hiddenIds = hidden; visibleIds = new Set((root ?? []).flatMap(descendantIds).filter(id => !hidden.has(id))); }
    } catch (failure) { if (current === request && matchesActiveModel()) error = String(failure); }
  }
  function switchView() { request++; loading = false; root = null; expanded = new Set(); names = {}; nameKey = ""; scrollTop = 0; menu = null; void loadTree(); }
  async function showAll() {
    try { await onAction("showAll", []); await refreshVisibility(); }
    catch (failure) { error = String(failure); }
  }
  function clearSemantic() { semanticHits=null;filterReset++; }
  function acceptSemantic(ids: Set<number> | null) {
    semanticHits=ids;
    if(ids && !root && modelReady) {treeRequested=true;autoLoadOwner=owner;void loadTree();}
  }
  function toggle(node: BrowserNode) { const next=new Set(expanded); next.has(node.id)?next.delete(node.id):next.add(node.id); expanded=next; onExpanded([...next]); }
  function select(node: BrowserNode, event: MouseEvent) {
    if (node.localId === null) { toggle(node); return; }
    if (event.ctrlKey || event.metaKey) {
      const ids = new Set(selected); ids.has(node.localId) ? ids.delete(node.localId) : ids.add(node.localId); void onSelect([...ids]).catch(failure=>error=String(failure));
    } else void onSelect([node.localId]).catch(failure=>error=String(failure));
  }
  function contextMenu(node: BrowserNode, event: MouseEvent) {
    if (!matchesActiveModel()) return;
    event.preventDefault(); const panel=panelHost.getBoundingClientRect();
    menu = { node, x: Math.min(event.clientX, innerWidth - 180)-panel.left, y: Math.min(event.clientY, innerHeight - 230)-panel.top };
  }
  function contextKey(node: BrowserNode, event: KeyboardEvent) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const box = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    const panel=panelHost.getBoundingClientRect();
    menu = { node, x: (box?.left ?? panel.left+12)-panel.left, y: (box?.bottom ?? panel.top+60)-panel.top };
  }
  async function act(action: "hide" | "isolate" | "fit" | "showAll" | "properties" | "selectChildren") {
    const node = menu?.node; menu = null;
    if (!node || !matchesActiveModel()) return;
    const ids = descendantIds(node);
    if (action === "selectChildren") { try {await onSelect(ids);} catch(failure){error=String(failure);} return; }
    if (action === "properties" && node.localId !== null) { await onAction(action, [node.localId]); return; }
    if (!ids.length && action !== "showAll") return;
    try { await onAction(action, ids); if (action === "hide" || action === "isolate" || action === "showAll") await refreshVisibility(); }
    catch (failure) { error = String(failure); }
  }
  function reveal() {
    if (!root || !selected.size) return;
    search = ""; ifcType = ""; scope = "all"; clearSemantic();
    const stack = root.map(node=>({node,path:[] as string[]}));
    while (stack.length) { const {node,path}=stack.pop()!; if(node.localId!==null && selected.has(node.localId)) {
      expanded=new Set([...expanded,...path]); onExpanded([...expanded]);
      const index=visibleTreeRows(root,expanded).findIndex(row=>row.node.id===node.id);
      scrollTop=Math.max(0,index*28-56); if(treeHost) treeHost.scrollTop=scrollTop; return;
    } for(const child of node.children) stack.push({node:child,path:[...path,node.id]}); }
  }
</script>
<aside bind:this={panelHost} class="project-browser workspace-panel" class:panel-open={open} aria-label="Project Browser" aria-hidden={!open} inert={!open}>
  <header><strong>Project Browser</strong><button aria-label="Close Project Browser" onclick={onClose}>×</button></header>
  <div class="browser-views"><h3>Views</h3>
    {#each doc?.views ?? [] as item (item.id)}<button disabled={state.busy} class:active={item.id===doc?.activeViewId} onclick={()=>onView(item.id)}>{item.type==="sectionBox"?"◇":"▧"} {item.name}</button>{/each}
  </div>
  <div class="browser-model-heading"><button disabled={!modelReady || loading} onclick={openTree}>{loading?"Loading…":"Model"}</button>
    {#if modelReady && root && selected.size}<button onclick={reveal} title="Reveal selected element">↳ {selected.size}</button>{/if}
    {#if modelReady && root}<button onclick={()=>void showAll()} title="Show all elements" aria-label="Show all elements">◉</button>{/if}
  </div>
  <div class="browser-filters">
    <label>View by <select bind:value={viewMode} onchange={switchView} disabled={!modelReady}>
      <option value="spatial">Spatial</option><option value="systems">Systems</option><option value="types">Types</option>
      <option value="groups">Groups</option><option value="classification">Classification</option><option value="material">Material</option>
    </select></label>
    <input aria-label="Search tree" placeholder="Search name, GlobalId, IFC type" bind:value={search} disabled={!modelReady || !root} />
    <div class="browser-filter-row"><select aria-label="IFC type filter" bind:value={ifcType} disabled={!modelReady || !root}>
      <option value="">All IFC types</option>{#each typeOptions as type}<option value={type}>{type}</option>{/each}
    </select><select aria-label="Tree scope" bind:value={scope} disabled={!modelReady || !root} onchange={()=>{ if(scope==="visible") void refreshVisibility(); }}>
      <option value="all">All</option><option value="visible">Visible</option><option value="selected">Selected</option>
    </select></div>
  </div>
  <BimFilter {service} {owner} {open} {modelReady} {ifcType} {locale} reset={filterReset} {eligibleIds}
    onResults={acceptSemantic} {onSelect} onAction={async (action,ids)=>{await onAction(action,ids);await refreshVisibility();}} />
  {#if modelReady && error}<p role="alert">{error}</p>{/if}
  {#if modelReady && root && coldStatus === "indexing"}<p>INDEX đang lập. Systems, Groups và Classification có thể chưa đầy đủ; bấm Model để tải lại.</p>{/if}
  {#if modelReady && root && viewMode !== "spatial" && !root.length}<p>Không có nhóm trong view này. Semantic index có thể vẫn đang lập; bấm Model để tải lại.</p>{/if}
  {#if !modelReady}<p>{doc?"Đang chuyển mô hình; Tree sẽ hiện khi IFC đang xem sẵn sàng.":"Mở một IFC để bắt đầu."}</p>
  {:else if !root && !loading}<p>Mở Model để xem cây IFC.</p>{/if}
  {#if modelReady}<div class="model-tree-scroll" bind:this={treeHost} onscroll={e=>scrollTop=e.currentTarget.scrollTop}>
    <div style={`height:${rows.length*28}px;position:relative`} role="tree" aria-label="IFC Model">
      {#each visible as row, i (row.node.id)}
        <div class="model-tree-row" class:selected={row.node.localId!==null&&selected.has(row.node.localId)} class:hidden={row.node.localId!==null&&hiddenIds.has(row.node.localId)} style={`top:${(start+i)*28}px;padding-left:${row.depth*12+4}px`}>
          <button class="tree-expand" disabled={!row.node.children.length || state.busy} aria-label={`Expand ${row.node.label}`} aria-expanded={row.node.children.length ? expanded.has(row.node.id) : undefined} onclick={()=>toggle(row.node)}>{row.node.children.length ? expanded.has(row.node.id)?"▾":"▸":"·"}</button>
          <button role="treeitem" data-local-id={row.node.localId} aria-selected={row.node.localId!==null&&selected.has(row.node.localId)} aria-haspopup="menu" disabled={state.busy} title={names[row.node.localId??-1] || row.node.label} oncontextmenu={event=>contextMenu(row.node,event)} onkeydown={event=>contextKey(row.node,event)}
            onclick={event=>select(row.node,event)}><span class="tree-kind" aria-hidden="true">{row.node.kind==="category"?"▣":row.node.kind==="facet"?"◇":row.node.ifcType?.includes("Wall")?"▥":row.node.ifcType?.includes("Door")?"▤":"•"}</span> {names[row.node.localId??-1] || row.node.label}{row.node.count !== undefined ? ` (${row.node.count})` : ""}</button>
        </div>
      {/each}
    </div>
  </div>{/if}
  {#if modelReady && menu}
    <div class="tree-context-menu" style={`left:${menu.x}px;top:${menu.y}px`} role="menu">
      <button onclick={()=>void act("hide")}>Hide</button><button onclick={()=>void act("isolate")}>Isolate</button>
      <button onclick={()=>void act("fit")}>Fit to element</button><button onclick={()=>void act("selectChildren")}>Select children</button>
      {#if menu.node.localId !== null}<button onclick={()=>void act("properties")}>Show Properties</button>{/if}
      <button onclick={()=>menu=null}>Close</button>
    </div>
  {/if}
  <button class="browser-resize" aria-label="Resize Project Browser" onpointerdown={onResize}></button>
</aside>
