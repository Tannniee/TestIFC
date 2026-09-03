<script lang="ts">
  import { panelMotion } from "./panel-motion";
  import { onDestroy } from "svelte";
  import { activeDocument, activeView, type WorkspaceState } from "./workspace-contracts";
  import { visibleTreeRows, type BrowserNode, type ModelDataService } from "./model-data-service";
  export let state: WorkspaceState;
  export let modelKey: string;
  export let service: ModelDataService;
  export let onView: (id: string) => void;
  export let onSelect: (ids: number[]) => void;
  export let onExpanded: (ids: string[]) => void;
  export let onClose: () => void;
  export let onResize: (event: PointerEvent) => void;
  let owner = "", request = 0, root: BrowserNode[] | null = null, loading = false, error = "";
  let expanded = new Set<string>(), names: Record<number,string> = {}, scrollTop = 0, nameKey = "";
  let treeHost: HTMLDivElement;
  onDestroy(() => { request++; });
  $: doc = activeDocument(state);
  $: view = activeView(state);
  $: selected = new Set(view?.state.selection.map(ref => ref.localId) ?? []);
  $: if (owner !== modelKey) {
    owner = modelKey; request++; root = null; loading = false; error = ""; names = {}; nameKey = ""; scrollTop = 0;
    expanded = new Set(doc?.expandedNodes ?? []);
  }
  $: rows = visibleTreeRows(root ?? [], expanded);
  $: start = Math.max(0,Math.floor(scrollTop/28)-5);
  $: visible = rows.slice(start,start+50);
  $: nextNames = `${owner}:${visible.map(r => r.node.localId).join(",")}`;
  $: if (root && !state.busy && nextNames !== nameKey) { nameKey = nextNames; void loadNames(visible.map(r=>r.node.localId).filter((id): id is number => id !== null)); }
  async function loadNames(ids: number[]) {
    const current = request;
    try { const result = await service.getNames(ids); if (current === request) names = { ...names,...result }; }
    catch (failure) { if (current === request && !state.busy) error = String(failure); }
  }
  async function loadTree() {
    if (loading || state.busy) return;
    const current = ++request; loading = true; error = "";
    try { const result = await service.getTree(); if (current === request) { root=result; if(!expanded.size) expanded=new Set(result.map(n=>n.id)); } }
    catch (failure) { if (current === request) error=String(failure); }
    finally { if(current===request) loading=false; }
  }
  function toggle(node: BrowserNode) { const next=new Set(expanded); next.has(node.id)?next.delete(node.id):next.add(node.id); expanded=next; onExpanded([...next]); }
  function select(node: BrowserNode, event: MouseEvent) {
    if (node.localId === null) { toggle(node); return; }
    if (event.ctrlKey || event.metaKey) {
      const ids = new Set(selected); ids.has(node.localId) ? ids.delete(node.localId) : ids.add(node.localId); onSelect([...ids]);
    } else onSelect([node.localId]);
  }
  function reveal() {
    if (!root || !selected.size) return;
    const stack = root.map(node=>({node,path:[] as string[]}));
    while (stack.length) { const {node,path}=stack.pop()!; if(node.localId!==null && selected.has(node.localId)) {
      expanded=new Set([...expanded,...path]); onExpanded([...expanded]);
      const index=visibleTreeRows(root,expanded).findIndex(row=>row.node.id===node.id);
      scrollTop=Math.max(0,index*28-56); if(treeHost) treeHost.scrollTop=scrollTop; return;
    } for(const child of node.children) stack.push({node:child,path:[...path,node.id]}); }
  }
</script>
<aside class="project-browser" aria-label="Project Browser" transition:panelMotion={"left"}>
  <header><strong>Project Browser</strong><button aria-label="Close Project Browser" onclick={onClose}>×</button></header>
  <div class="browser-views"><h3>Views</h3>
    {#each doc?.views ?? [] as item (item.id)}<button disabled={state.busy} class:active={item.id===doc?.activeViewId} onclick={()=>onView(item.id)}>{item.type==="sectionBox"?"◇":"▧"} {item.name}</button>{/each}
  </div>
  <div class="browser-model-heading"><button disabled={!doc || state.busy || loading} onclick={loadTree}>{loading?"Loading…":"Model"}</button>
    {#if root && selected.size}<button onclick={reveal} title="Reveal selected element">↳ {selected.size}</button>{/if}
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if !root && !loading}<p>{doc?"Mở Model để xem cây IFC.":"Mở một IFC để bắt đầu."}</p>{/if}
  <div class="model-tree-scroll" bind:this={treeHost} onscroll={e=>scrollTop=e.currentTarget.scrollTop}>
    <div style={`height:${rows.length*28}px;position:relative`} role="tree" aria-label="IFC Model">
      {#each visible as row, i (row.node.id)}
        <div class="model-tree-row" class:selected={row.node.localId!==null&&selected.has(row.node.localId)} style={`top:${(start+i)*28}px;padding-left:${row.depth*12+4}px`}>
          <button class="tree-expand" disabled={!row.node.children.length || state.busy} aria-label={`Expand ${row.node.label}`} aria-expanded={row.node.children.length ? expanded.has(row.node.id) : undefined} onclick={()=>toggle(row.node)}>{row.node.children.length ? expanded.has(row.node.id)?"▾":"▸":"·"}</button>
          <button role="treeitem" data-local-id={row.node.localId} aria-selected={row.node.localId!==null&&selected.has(row.node.localId)} disabled={state.busy} title={names[row.node.localId??-1] || row.node.label}
            onclick={event=>select(row.node,event)}>{names[row.node.localId??-1] || row.node.label}</button>
        </div>
      {/each}
    </div>
  </div>
  <button class="browser-resize" aria-label="Resize Project Browser" onpointerdown={onResize}></button>
</aside>
