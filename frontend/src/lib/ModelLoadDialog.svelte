<script lang="ts">
  import { onMount } from "svelte";
  import type { ViewerProgress } from "./viewer-contracts";
  import type { CopyText } from "./i18n";
  import { loadProgressValue } from "./load-progress";

  export let progress: ViewerProgress;
  export let fileName: string;
  export let text: CopyText;
  export let cancelling = false;
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
  onMount(() => { dialog.showModal(); return () => dialog.close(); });
</script>

<dialog bind:this={dialog} class="model-load-dialog" aria-labelledby="model-load-title" oncancel={(event) => { event.preventDefault(); if (!cancelling) onCancel(); }}>
  <header><h2 id="model-load-title">{text.loadTitle}</h2></header>
  <div class="model-load-body">
    <p class="model-load-filename" title={fileName}>{fileName}</p>
    <div class="model-load-label"><span>{text.loadOverall}</span><strong>{Math.floor(overall)}%</strong></div>
    <progress aria-label={text.loadOverall} max="100" value={overall}></progress>
    <div class="model-load-label model-load-step" aria-live="polite"><span>{label}</span><span>{!cancelling && value.step !== undefined ? `${Math.round(value.step * 100)}%` : ""}</span></div>
    {#if !cancelling && value.step !== undefined}
      <progress aria-label={text.loadStep} max="1" value={value.step}></progress>
    {:else}
      <progress aria-label={text.loadStep} max="1"></progress>
    {/if}
    <p class="model-load-detail">{progress.category ?? ""}{progress.category && progress.entitiesProcessed !== undefined ? ` · ${progress.entitiesProcessed.toLocaleString()} ${text.loadItems}` : ""}</p>
  </div>
  <footer><button type="button" disabled={cancelling} onclick={onCancel}>{cancelling ? text.cancelling : text.cancelLoad}</button></footer>
</dialog>

<style>
  .model-load-dialog { width: min(620px, calc(100vw - 40px)); padding: 0; border: 1px solid #790b96; border-radius: 12px; background: var(--surface-elevated, #fff); color: var(--text-primary, #19232d); box-shadow: 0 20px 70px #0005; }
  .model-load-dialog::backdrop { background: #10141b55; }
  header { padding: 14px 20px; background: #780b92; color: #fff; }
  h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .model-load-body { padding: 18px 20px 8px; }
  .model-load-filename { margin: 0 0 20px; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .model-load-label { display: flex; justify-content: space-between; gap: 14px; font-size: 13px; margin-bottom: 8px; }
  .model-load-label strong { font-variant-numeric: tabular-nums; }
  .model-load-step { margin-top: 20px; min-height: 18px; }
  progress { display: block; width: 100%; height: 16px; appearance: none; border: 0; border-radius: 4px; overflow: hidden; background: #dfe3e8; accent-color: #a22533; }
  progress::-webkit-progress-bar { background: #dfe3e8; border-radius: 4px; }
  progress::-webkit-progress-value { background: #a22533; border-radius: 4px; transition: width 120ms linear; }
  progress:indeterminate { background: linear-gradient(90deg, #dfe3e8 0%, #a22533 45%, #dfe3e8 75%); background-size: 200% 100%; animation: loading 1.5s linear infinite; }
  progress:indeterminate::-webkit-progress-bar { background: transparent; }
  .model-load-detail { min-height: 16px; margin: 8px 0 0; font-size: 11px; opacity: .7; overflow-wrap: anywhere; }
  footer { display: flex; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid #c5c9cf; }
  button { min-width: 108px; padding: 8px 18px; background: transparent; color: inherit; border: 1px solid #1785d6; border-radius: 5px; cursor: pointer; }
  button:focus-visible { outline: 2px solid #1785d6; outline-offset: 3px; }
  button:disabled { opacity: .6; cursor: wait; }
  @keyframes loading { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { progress { animation: none !important; } progress::-webkit-progress-value { transition: none; } }
</style>
