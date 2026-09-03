<script lang="ts">
  import { onMount } from "svelte";
  import type { ViewerProgress } from "./viewer-contracts";
  import type { CopyText } from "./i18n";
  import { loadProgressValue } from "./load-progress";

  export let progress: ViewerProgress;
  export let fileName: string;
  export let text: CopyText;
  export let cancelling = false;
  export let modal = true;
  export let onCancel: () => void;
  let dialog: HTMLDialogElement;
  let currentSequence = -1;
  let overall = 0;
  $: value = loadProgressValue(progress);
  $: if (currentSequence !== progress.loadSequence) { currentSequence = progress.loadSequence; overall = 0; }
  $: overall = Math.max(overall, value.overall);
  $: label = cancelling ? text.cancelling : progress.stage === "converting"
    ? (progress.phase === "geometries" ? text.loadGeometry : progress.phase === "attributes" ? text.loadAttributes
      : progress.phase === "relations" ? text.loadRelations : text.converting)
    : progress.stage === "loading"
      ? (progress.phase === "decompressing" ? text.loadDecompress : progress.phase === "parsing" ? text.loadParse : text.loading)
      : progress.stage === "hashing" ? text.loadHash : progress.stage === "cache" ? text.cache
        : progress.stage === "finalizing" ? text.loadFinalize : text.opening;
  onMount(() => { if (modal) dialog.showModal(); else dialog.show(); return () => dialog.close(); });
</script>

<dialog bind:this={dialog} class="model-load-dialog" class:workspace-loading={!modal} aria-labelledby="model-load-title" oncancel={(event) => { event.preventDefault(); if (!cancelling) onCancel(); }}>
  <header><span class="model-load-spinner" aria-hidden="true"></span><h2 id="model-load-title">{text.loadTitle}</h2></header>
  <div class="model-load-body">
    <p class="model-load-filename" title={fileName}>{fileName}</p>
    <div class="model-load-label">{text.loadOverall}</div>
    <div class="model-load-track">
      <progress aria-label={text.loadOverall} max="100" value={overall}></progress>
      <span class="model-load-percent" aria-hidden="true">{Math.floor(overall)}%</span>
    </div>
    <div class="model-load-label model-load-step" aria-live="polite">{label}</div>
    <div class="model-load-track">
      {#if !cancelling && value.step !== undefined}
        <progress aria-label={text.loadStep} max="1" value={value.step}></progress>
        <span class="model-load-percent" aria-hidden="true">{Math.round(value.step * 100)}%</span>
      {:else}
        <progress aria-label={text.loadStep} max="1"></progress>
      {/if}
    </div>
    {#if progress.category}
      <p class="model-load-detail" title={progress.category}>{progress.category}{progress.entitiesProcessed !== undefined ? ` · ${progress.entitiesProcessed.toLocaleString()} ${text.loadItems}` : ""}</p>
    {/if}
  </div>
  <footer><button type="button" disabled={cancelling} onclick={onCancel}>{cancelling ? text.cancelling : text.cancelLoad}</button></footer>
</dialog>

<style>
  .model-load-dialog { --load-fill: color-mix(in oklab, var(--accent-primary) 32%, var(--surface-elevated)); width: min(320px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); padding: 0; overflow-x: hidden; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-elevated); color: var(--text-primary); font: var(--font-size-xs)/1.4 var(--font-sans); box-shadow: 0 12px 36px #0004; }
  .model-load-dialog::backdrop { background: #10141b33; }
  .model-load-dialog.workspace-loading { position: fixed; left: 50%; top: 50%; margin: 0; transform: translate(-50%, -50%); z-index: 100; }
  header { display: flex; align-items: center; gap: 7px; padding: 8px 12px; background: var(--surface-overlay); }
  h2 { margin: 0; font-size: var(--font-size-sm); font-weight: 600; }
  .model-load-spinner { width: 12px; height: 12px; flex: none; border: 2px solid var(--border-subtle); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin .9s linear infinite; }
  .model-load-body { padding: 10px 12px 0; }
  .model-load-filename { margin: 0 0 8px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .model-load-label { margin-bottom: 3px; color: var(--text-secondary); }
  .model-load-step { margin-top: 8px; }
  .model-load-track { position: relative; height: 16px; }
  .model-load-percent { position: absolute; inset: 0; display: grid; place-items: center; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; pointer-events: none; }
  progress { display: block; width: 100%; height: 100%; appearance: none; border: 1px solid var(--border-subtle); border-radius: 3px; overflow: hidden; background: var(--surface-sunken); accent-color: var(--load-fill); }
  progress::-webkit-progress-bar { background: var(--surface-sunken); }
  progress::-webkit-progress-value { background: var(--load-fill); transition: width 120ms linear; }
  progress::-moz-progress-bar { background: var(--load-fill); }
  progress:indeterminate { background: linear-gradient(90deg, var(--surface-sunken) 0%, var(--load-fill) 45%, var(--surface-sunken) 75%); background-size: 200% 100%; animation: loading 1.5s linear infinite; }
  progress:indeterminate::-webkit-progress-bar { background: transparent; }
  .model-load-detail { margin: 6px 0 0; color: var(--text-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  footer { display: flex; justify-content: flex-end; padding: 8px 12px 10px; border: 0; background: transparent; }
  button { min-width: 64px; min-height: 26px; padding: 4px 12px; background: var(--surface-overlay); color: var(--text-secondary); border: 1px solid var(--border-default); border-radius: var(--radius-sm); cursor: pointer; }
  button:hover:not(:disabled) { color: var(--text-primary); border-color: var(--accent-primary); background: var(--surface-sunken); }
  button:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
  button:disabled { opacity: .6; cursor: wait; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes loading { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { progress, .model-load-spinner { animation: none; } progress::-webkit-progress-value { transition: none; } }
</style>
