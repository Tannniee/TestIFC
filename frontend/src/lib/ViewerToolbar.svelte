<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { CopyText } from "./i18n";
  import type { MeasureMode, ViewerTool } from "./viewer-contracts";

  export let text: CopyText;
  export let hasModel: boolean;
  export let tool: ViewerTool;
  export let measureMode: MeasureMode;
  export let onTool: (tool: ViewerTool) => void;
  export let onMeasureMode: (mode: MeasureMode) => void;

  const tools: { id: ViewerTool; icon: "pan" | "pointer" | "multiSelect" | "measure" }[] = [
    { id: "pan", icon: "pan" },
    { id: "selectOrbit", icon: "pointer" },
    { id: "multiSelect", icon: "multiSelect" },
    { id: "measure", icon: "measure" },
  ];

</script>

<aside class="viewer-toolbar" aria-label={text.viewerTools}>
  <div class="viewer-toolbar__tools" role="toolbar" aria-label={text.viewerTools}>
    {#each tools as item}
      <button
        class:viewer-toolbar__button--active={tool === item.id}
        class="viewer-toolbar__button"
        title={text[item.id]}
        aria-label={text[item.id]}
        aria-pressed={tool === item.id}
        disabled={item.id !== "pan" && !hasModel}
        onclick={() => onTool(item.id)}
      ><Icon name={item.icon} /></button>
    {/each}
  </div>

  {#if tool === "multiSelect"}
    <p class="viewer-toolbar__navigation-hint">{text.multiSelectHint}</p>
  {/if}

  {#if tool === "selectOrbit"}
    <p class="viewer-toolbar__navigation-hint">{text.selectOrbitHint}</p>
  {/if}

  {#if tool === "measure"}
    <section class="viewer-toolbar__measure" aria-label={text.measureOptions}>
      <div class="viewer-toolbar__measure-modes" role="group" aria-label={text.measureOptions}>
        <button class:viewer-toolbar__measure-mode--active={measureMode === "pointToPoint"} onclick={() => onMeasureMode("pointToPoint")}>
          <Icon name="point" size={18} /><span>{text.pointToPoint}</span>
        </button>
        <button class:viewer-toolbar__measure-mode--active={measureMode === "edge"} onclick={() => onMeasureMode("edge")}>
          <Icon name="edge" size={18} /><span>{text.snapEdge}</span>
        </button>
      </div>
    </section>
  {/if}
</aside>
