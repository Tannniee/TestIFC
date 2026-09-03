<script lang="ts">
  import { panelMotion } from "./panel-motion";
  import { onDestroy } from "svelte";
  import SectionBoxPanel from "./SectionBoxPanel.svelte";
  import type { ViewerSelection, SectionBoxState } from "./viewer-contracts";
  import type { ViewSession } from "./workspace-contracts";
  import type { ModelDataService, PropertyGroup } from "./model-data-service";
  export let open: boolean;
  export let view: ViewSession | null;
  export let selection: ViewerSelection | null;
  export let count: number;
  export let box: SectionBoxState | null;
  export let locale: "vi" | "en";
  export let preferView = false;
  export let busy = false;
  export let service: ModelDataService;
  export let onClose: () => void;
  export let onResizeStart: (event: PointerEvent) => void;
  export let onResizeKeydown: (event: KeyboardEvent) => void;
  export let onBox: (box: SectionBoxState) => void;
  export let onDraw: () => void;
  export let onFit: () => void;
  export let onReset: () => void;
  export let onDisplay: (display: {showBox:boolean;showHandles:boolean}) => void;
  let groups: PropertyGroup[] = [], loading = false, error = "", request = 0, owner = "", detail = "";
  $: currentOwner = `${view?.id}:${selection?.modelId}:${selection?.localId}:${preferView}:${busy}`;
  $: if (owner !== currentOwner) { owner=currentOwner; request++; groups=[]; loading=false; error=""; detail=""; }
  $: showElement = Boolean(selection && !preferView);
  async function load(group: "attributes" | "properties" | "materials" | "location") {
    if(!selection || busy) return; const current=++request; loading=true; error=""; detail=group;
    try { const result=await service.getProperties(selection.localId!,group); if(current===request) groups=result; }
    catch(failure) { if(current===request) error=String(failure); }
    finally { if(current===request) loading=false; }
  }
  onDestroy(()=>{ request++; });
</script>
{#if open}
  <aside class="properties-panel qn-drawer qn-drawer-open" aria-label="Properties" aria-busy={busy} transition:panelMotion={"right"}>
    <button class="qn-drawer-handle" aria-label="Resize Properties" onpointerdown={onResizeStart} onkeydown={onResizeKeydown}></button>
    <header><strong>Properties</strong><button aria-label="Close Properties" onclick={onClose}>×</button></header>
    <div class="properties-body">
      <fieldset disabled={busy} class="properties-content">
      {#if selection}<div class="properties-context"><button class:active={showElement} onclick={()=>preferView=false}>Element</button><button class:active={!showElement} onclick={()=>preferView=true}>View</button></div>{/if}
      {#if showElement && selection}
        <h3>{selection.ifcType ?? "IFC Element"}</h3>
        <dl class="property-identity">
          <dt>Name</dt><dd>{selection.name ?? "—"}</dd>
          <dt>IFC type</dt><dd>{selection.ifcType ?? "—"}</dd>
          <dt>GlobalId</dt><dd>{selection.globalId ?? "—"}</dd>
          <dt>Express ID</dt><dd>{selection.expressId ?? "—"}</dd>
        </dl>
        <div class="property-sections">
          {#each ["attributes","properties","materials","location"] as group}<button disabled={busy} class:active={detail===group} onclick={()=>load(group as "attributes" | "properties" | "materials" | "location")}>{group==="properties"?"Psets / Quantities":group[0].toUpperCase()+group.slice(1)}</button>{/each}
        </div>
        {#if loading}<p>Loading…</p>{/if}
        {#if error}<p role="alert">{error}</p>{/if}
        {#if detail && !loading && !error && (!groups.length || (detail!=="attributes" && groups.every(g=>g.name==="Attributes")))}<p>Không có dữ liệu quan hệ trong fragments hiện tại.</p>{/if}
        {#each groups as group}<section class="property-group"><h4>{group.name}</h4><dl class="property-identity">{#each group.rows as row}<dt>{row.name}</dt><dd>{row.value}</dd>{/each}</dl></section>{/each}
      {:else}
        {#if count>1}<p>{count} elements selected</p>{/if}
        <h3>{view?.name ?? "Workspace"}</h3>
        <dl class="property-identity"><dt>Projection</dt><dd>Orthographic</dd><dt>Clipping</dt><dd>{view?.state.clipping.kind ?? "none"}</dd></dl>
        {#if box}
          <SectionBoxPanel embedded {box} {locale} onChange={onBox} {onDraw} {onFit} {onReset} onClose={()=>{}} />
          <label class="box-display"><input type="checkbox" checked={view?.state.boxDisplay.showBox ?? true} onchange={e=>onDisplay({showBox:e.currentTarget.checked,showHandles:view?.state.boxDisplay.showHandles??true})} /> Show Box</label>
          <label class="box-display"><input type="checkbox" checked={view?.state.boxDisplay.showHandles ?? true} onchange={e=>onDisplay({showBox:view?.state.boxDisplay.showBox??true,showHandles:e.currentTarget.checked})} /> Show Handles</label>
        {/if}
      {/if}
      </fieldset>
    </div>
  </aside>
{/if}
