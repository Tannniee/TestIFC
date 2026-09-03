<script lang="ts">
  import { activeDocument, type WorkspaceState } from "./workspace-contracts";
  export let state: WorkspaceState;
  export let onDocument: (id: string) => void;
  export let onView: (id: string) => void;
  export let onCloseDocument: (id: string) => void;
  export let onCloseView: (id: string) => void;
  export let onOpen: () => void;
  export let onBrowser: () => void;
  $: doc = activeDocument(state);
</script>
<div class="workspace-tabs">
  <div class="workspace-tab-row document-tabs" role="tablist" aria-label="IFC Documents">
    <button class="workspace-browser-toggle" title="Project Browser" aria-label="Project Browser" onclick={onBrowser}>☰</button>
    {#each state.documents as document (document.id)}
      <div class:active={document.id === state.activeDocumentId} class:pending={document.id === state.requestedDocumentId} class="workspace-tab">
        <button role="tab" aria-selected={document.id === state.activeDocumentId} title={document.error ?? document.filename} onclick={() => onDocument(document.id)}>{document.error ? "! " : ""}{document.filename}{document.id === state.requestedDocumentId ? " …" : ""}</button>
        {#if document.sourceIssue}<button disabled={state.busy} title="Cùng nội dung giữ các View; nội dung khác mở document mới" aria-label={`Chọn lại IFC ${document.filename}`} onclick={onOpen}>Chọn lại IFC</button>{/if}
        <button class="tab-close" aria-label={`Close ${document.filename}`} onclick={() => onCloseDocument(document.id)}>×</button>
      </div>
    {/each}
    <button class="tab-add" aria-label="Open IFC" onclick={onOpen}>+</button>
  </div>
  {#if doc}
    <div class="workspace-tab-row view-tabs" role="tablist" aria-label="Views">
      {#each doc.views as view (view.id)}
        <div class:active={view.id === doc.activeViewId} class="workspace-tab">
          <button disabled={state.busy} role="tab" aria-selected={view.id === doc.activeViewId} onclick={() => onView(view.id)}>{view.name}</button>
          {#if view.type !== "default3d"}<button disabled={state.busy} class="tab-close" aria-label={`Close ${view.name}`} onclick={() => onCloseView(view.id)}>×</button>{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
