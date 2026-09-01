<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { CopyText } from "./i18n";
  import type { MeasureMode, MeasurementResult, ViewerTool } from "./viewer-contracts";
  import { formatMeasurement, measurementInputToMeters, type MeasurementUnit } from "./viewer-tool-math";

  export let text: CopyText;
  export let hasModel: boolean;
  export let tool: ViewerTool;
  export let measureMode: MeasureMode;
  export let measurements: MeasurementResult[];
  export let onTool: (tool: ViewerTool) => void;
  export let onMeasureMode: (mode: MeasureMode) => void;
  export let onClearMeasurements: () => void;
  export let onSetDistance: (distance: number) => void;
  export let onQuit: () => void;

  let targetValue = "";
  let targetUnit: MeasurementUnit = "mm";
  let editedMeasurementId = 0;
  let latestMeasurement: MeasurementResult | null;
  let latestPointMeasurement: MeasurementResult | null;

  $: latestMeasurement = measurements.length ? measurements[measurements.length - 1] : null;
  $: latestPointMeasurement = [...measurements].reverse().find((item) => item.mode === "pointToPoint") ?? null;
  $: if (latestPointMeasurement && latestPointMeasurement.id !== editedMeasurementId) {
    editedMeasurementId = latestPointMeasurement.id;
    targetUnit = latestPointMeasurement.distance >= 1 ? "m" : "mm";
    targetValue = targetUnit === "m"
      ? latestPointMeasurement.distance.toFixed(3)
      : (latestPointMeasurement.distance * 1000).toFixed(1);
  }

  const tools: { id: ViewerTool; icon: "pan" | "multiSelect" | "measure" }[] = [
    { id: "pan", icon: "pan" },
    { id: "multiSelect", icon: "multiSelect" },
    { id: "measure", icon: "measure" },
  ];

  function applyDistance() {
    const distance = measurementInputToMeters(Number(targetValue.replace(",", ".")), targetUnit);
    if (Number.isFinite(distance)) onSetDistance(distance);
  }
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
    {#if tool !== "pan"}
      <button class="viewer-toolbar__quit" title={text.quitTool} aria-label={text.quitTool} onclick={onQuit}>
        <span>Quit</span><kbd>Esc</kbd>
      </button>
    {/if}
  </div>

  {#if tool === "multiSelect"}
    <p class="viewer-toolbar__navigation-hint">{text.multiSelectHint}</p>
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
      <p>{measureMode === "pointToPoint" ? text.pointToPointHint : text.snapEdgeHint}</p>
      <p class="viewer-toolbar__navigation-hint-inline">{text.toolNavigationHint}</p>
      {#if latestMeasurement}
        <output>{formatMeasurement(latestMeasurement.distance)}</output>
      {/if}
      {#if latestPointMeasurement}
        <label class="viewer-toolbar__distance-label" for="viewer-target-distance">{text.targetDistance}</label>
        <div class="viewer-toolbar__distance">
          <input
            id="viewer-target-distance"
            inputmode="decimal"
            bind:value={targetValue}
            aria-label={text.targetDistance}
            onkeydown={(event) => event.key === "Enter" && applyDistance()}
          />
          <select bind:value={targetUnit} aria-label={text.measureUnit}>
            <option value="mm">mm</option>
            <option value="m">m</option>
          </select>
          <button onclick={applyDistance}>{text.applyDistance}</button>
        </div>
      {/if}
      <small>{measurements.length} {text.measurementsOnScreen}</small>
      <button class="viewer-toolbar__clear" disabled={!measurements.length} onclick={onClearMeasurements}>
        <Icon name="trash" size={16} /><span>{text.clearAllMeasurements}</span>
      </button>
      <p class="viewer-toolbar__quit-hint">{text.quitHint}</p>
    </section>
  {/if}
</aside>
