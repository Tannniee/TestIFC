<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { CopyText } from "./i18n";
  import type { ViewerSelection } from "./viewer-contracts";

  export let text: CopyText;
  export let open: boolean;
  export let width: number;
  export let identityExpanded: boolean;
  export let selection: ViewerSelection | null;
  export let onClose: () => void;
  export let onToggleIdentity: () => void;
  export let onResizeStart: (event: PointerEvent) => void;
  export let onResizeKeydown: (event: KeyboardEvent) => void;
</script>

<aside class:qn-drawer-open={open} class="qn-drawer" aria-label={text.selection} style:width={`${width}px`}>
  <button class="qn-drawer-handle" aria-label="Resize panel" onpointerdown={onResizeStart} onkeydown={onResizeKeydown}></button>
  <header class="qn-drawer-header">
    <h2>{text.selection}</h2>
    <button class="qn-drawer-close" aria-label={text.close} onclick={onClose}><Icon name="close" size={17} /></button>
  </header>
  <div class="qn-drawer-body">
    <div class="drawer-heading"><span class="qn-badge qn-badge-soft">{selection?.ifcType ?? text.nothingSelected}</span></div>
    <section class="qn-property-group">
      <button class="qn-property-group__header" aria-expanded={identityExpanded} onclick={onToggleIdentity}><span>{identityExpanded ? "▾" : "▸"}</span> {text.identity}</button>
      {#if identityExpanded}<div class="qn-property-group__body">
        <div class="qn-property-row"><span class="qn-property-label">{text.status}</span><span class="qn-property-value">{selection ? "selected" : text.nothingSelected}</span></div>
        {#if selection}
          <div class="qn-property-row"><span class="qn-property-label">Name</span><span class="qn-property-value">{selection.name ?? "—"}</span></div>
          <div class="qn-property-row"><span class="qn-property-label">IFC type</span><span class="qn-property-value">{selection.ifcType ?? "—"}</span></div>
          <div class="qn-property-row"><span class="qn-property-label">GlobalId</span><span class="qn-property-value" title={selection.globalId ?? undefined}>{selection.globalId ?? "—"}</span></div>
          <div class="qn-property-row"><span class="qn-property-label">Express ID</span><span class="qn-property-value">{selection.expressId ?? "—"}</span></div>
        {/if}
      </div>{/if}
    </section>
    <p class="inspector-empty">{selection?.name ? `${text.element.replace(text.nothingSelected, selection.name)}` : text.element}</p>
  </div>
</aside>
