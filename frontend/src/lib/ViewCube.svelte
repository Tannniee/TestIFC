<script lang="ts">
  import type { CameraOrientation, ViewDirection } from "./viewer-contracts";
  import {
    VIEW_CUBE_DRAG_THRESHOLD,
    VIEW_CUBE_ORBIT_RADIANS_PER_PIXEL,
    VIEW_CUBE_QUICK_VIEWS,
    VIEW_CUBE_SURFACES,
    currentDirectionKey,
    directionKey,
    faceLabelTransform,
    isIsoOrientation,
    orientationTransform,
    surfaceClass,
    surfaceName,
    surfaceStyle,
    viewNames,
    type ViewCubeText,
  } from "./viewcube-math";

  export let disabled = false;
  export let orientation: CameraOrientation = { x: 0, y: 0, z: 0, w: 1 };
  export let text: ViewCubeText = {
    viewCube: "ViewCube",
    directions: "Model view directions",
    quickViews: "Quick views",
    viewFrom: "View from",
    edge: "Edge",
    corner: "Corner",
    left: "Left",
    right: "Right",
    back: "Back",
    front: "Front",
    top: "Top",
    bottom: "Bottom",
    homeIso: "Home / Isometric",
  };
  export let onDirection: (direction: ViewDirection) => void = () => {};
  export let onIso: () => void = () => {};
  export let onOrbit: (deltaAzimuth: number, deltaPolar: number) => void = () => {};

  const surfaces = VIEW_CUBE_SURFACES;
  const quickViews = VIEW_CUBE_QUICK_VIEWS;

  let hoveredKey: string | null = null;
  let pointerId: number | null = null;
  let pressedDirection: ViewDirection | null = null;
  let previousPointerX = 0;
  let previousPointerY = 0;
  let totalDragDistance = 0;
  let dragged = false;

  $: cubeTransform = orientationTransform(orientation);
  $: isoActive = isIsoOrientation(orientation);
  $: activeKey = isoActive ? null : currentDirectionKey(orientation);

  function activate(direction: ViewDirection) {
    if (!disabled && !dragged) onDirection(direction);
  }

  function handlePointerDown(event: PointerEvent) {
    if (disabled || event.button !== 0) return;
    const surfaceButton = (event.target as Element).closest<HTMLButtonElement>(".view-cube__surface");
    const surface = surfaces.find((candidate) => candidate.key === surfaceButton?.dataset.directionKey);
    pointerId = event.pointerId;
    pressedDirection = surface?.direction ?? null;
    previousPointerX = event.clientX;
    previousPointerY = event.clientY;
    totalDragDistance = 0;
    dragged = false;
  }

  function handlePointerMove(event: PointerEvent) {
    if (disabled || pointerId !== event.pointerId) return;
    const deltaX = event.clientX - previousPointerX;
    const deltaY = event.clientY - previousPointerY;
    previousPointerX = event.clientX;
    previousPointerY = event.clientY;
    totalDragDistance += Math.hypot(deltaX, deltaY);
    if (totalDragDistance <= VIEW_CUBE_DRAG_THRESHOLD) return;
    dragged = true;
    hoveredKey = null;
    event.preventDefault();
    onOrbit(deltaX * VIEW_CUBE_ORBIT_RADIANS_PER_PIXEL, deltaY * VIEW_CUBE_ORBIT_RADIANS_PER_PIXEL);
  }

  function handlePointerEnd(event: PointerEvent) {
    if (pointerId !== event.pointerId) return;
    const direction = !dragged ? pressedDirection : null;
    pointerId = null;
    pressedDirection = null;
    if (direction && !disabled) onDirection(direction);
    window.setTimeout(() => (dragged = false), 0);
  }

  function handlePointerCancel(event: PointerEvent) {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    pressedDirection = null;
    dragged = false;
  }

</script>

<svelte:window
  onpointermove={handlePointerMove}
  onpointerup={handlePointerEnd}
  onpointercancel={handlePointerCancel}
/>

<div class:disabled class="view-nav-cluster" aria-label={text.viewCube}>
  <div class="view-cube__panel">
    <div class="view-cube">
      <div
        class:is-dragging={dragged}
        class="view-cube__stage"
        role="group"
        aria-label={text.directions}
        onpointerdown={handlePointerDown}
      >
        <div class:has-active={Boolean(activeKey)} class="view-cube__body" style:transform={cubeTransform}>
          {#each surfaces as surface}
            <button
              type="button"
              class={surfaceClass(surface)}
              class:is-hovered={hoveredKey === surface.key}
              class:is-active={activeKey === surface.key}
              data-axis={surface.axis}
              data-direction-key={surface.key}
              style={surfaceStyle(surface)}
              disabled={disabled}
              aria-label={`${text.viewFrom} ${surfaceName(surface, text)}`}
              title={surfaceName(surface, text)}
              onclick={(event) => { if (event.detail === 0) activate(surface.direction); }}
              onmouseenter={() => (hoveredKey = surface.key)}
              onmouseleave={() => { if (hoveredKey === surface.key) hoveredKey = null; }}
              onfocus={() => (hoveredKey = surface.key)}
              onblur={() => { if (hoveredKey === surface.key) hoveredKey = null; }}
            >
              {#if surface.kind === "face"}
                <span class="view-cube__label" style:transform={faceLabelTransform(surface, orientation)}>{surface.label}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>

  <div class="view-controls" aria-label={text.quickViews}>
    {#each quickViews as quickView}
      <button
        type="button"
        class={`view-control-button ${quickView.className}`}
        class:is-active={activeKey === directionKey(quickView.direction)}
        disabled={disabled}
        aria-label={`${text.viewFrom} ${viewNames(quickView.direction, text).join(" / ")}`}
        data-tooltip={viewNames(quickView.direction, text).join(" / ")}
        onclick={() => activate(quickView.direction)}
        onmouseenter={() => (hoveredKey = directionKey(quickView.direction))}
        onmouseleave={() => { if (hoveredKey === directionKey(quickView.direction)) hoveredKey = null; }}
        onfocus={() => (hoveredKey = directionKey(quickView.direction))}
        onblur={() => { if (hoveredKey === directionKey(quickView.direction)) hoveredKey = null; }}
      >
        <svg class="mini-cube" viewBox="0 0 24 24" aria-hidden="true">
          <polygon class="face-highlight" points={quickView.highlight} />
          <path class="cube-hidden" d="M9 4H19.5V15.5H9Z" />
          <path class="cube-edge" d="M4.5 8H15V20H4.5Z M9 4H19.5V15.5 M4.5 8L9 4 M15 8L19.5 4 M15 20L19.5 15.5 M4.5 20L9 15.5" />
        </svg>
      </button>
    {/each}

    <button
      type="button"
      class="view-control-button home-view"
      class:is-active={isoActive}
      disabled={disabled}
      aria-label={text.homeIso}
      data-tooltip={text.homeIso}
      onclick={onIso}
      onmouseenter={() => (hoveredKey = null)}
      onfocus={() => (hoveredKey = null)}
    >
      <svg class="home-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 10.5 12 3.5l8.5 7" />
        <path d="M5.5 9.2V20h13V9.2" />
        <path d="M9.5 20v-6h5v6" />
      </svg>
    </button>
  </div>
</div>

<style>
  .view-nav-cluster {
    width: 204px; height: 234px; position: relative;
    display: flex; align-items: flex-start; gap: 4px;
    color: var(--text-primary); user-select: none; opacity: .82;
    filter: drop-shadow(0 7px 12px rgba(0, 0, 0, .3));
    transition: opacity 140ms ease;
  }
  .view-nav-cluster:hover, .view-nav-cluster:focus-within { opacity: 1; }
  .view-cube__panel {
    width: 170px; height: 170px; padding: 3px;
    border: 0; background: transparent;
  }
  .view-cube { width: 164px; height: 164px; position: relative; display: grid; place-items: start center; }
  .view-cube__stage {
    width: 158px; height: 158px; position: relative; display: grid; place-items: center;
    perspective: 560px; touch-action: none; cursor: grab;
  }
  .view-cube__stage.is-dragging { cursor: grabbing; }
  .view-cube__body { width: 96px; height: 96px; position: relative; transform-style: preserve-3d; will-change: transform; }
  .view-cube__surface {
    padding: 0; position: absolute; top: 50%; left: 50%; box-sizing: border-box;
    border: 1px solid var(--view-cube-border);
    display: grid; place-items: center; color: var(--text-primary); font: 750 9px/1 var(--font-sans);
    backface-visibility: hidden; transform-style: preserve-3d; cursor: pointer; outline: none;
    transition: background 100ms ease, border-color 100ms ease, filter 100ms ease, box-shadow 100ms ease, opacity 100ms ease;
  }
  .view-cube__surface--face { border-radius: 2px; box-shadow: inset 0 0 18px rgba(255, 255, 255, .04); }
  .view-cube__surface--face[data-axis="x"] { background: linear-gradient(145deg, color-mix(in oklch, #d84a4a 32%, var(--view-cube-surface-high)), color-mix(in oklch, #d84a4a 48%, var(--view-cube-surface-low))); }
  .view-cube__surface--face[data-axis="y"] { background: linear-gradient(145deg, color-mix(in oklch, #45a66b 27%, var(--view-cube-surface-high)), color-mix(in oklch, #45a66b 43%, var(--view-cube-surface-low))); }
  .view-cube__surface--face[data-axis="z"] { background: linear-gradient(145deg, color-mix(in oklch, #3478db 30%, var(--view-cube-surface-high)), color-mix(in oklch, #3478db 48%, var(--view-cube-surface-low))); }
  .view-cube__surface--edge {
    border-color: var(--view-cube-border);
    background: linear-gradient(180deg, var(--view-cube-surface-high), var(--view-cube-surface-low));
    box-shadow: inset 0 0 8px rgba(255, 255, 255, .06);
  }
  .view-cube__surface--corner {
    border: 0; background: linear-gradient(160deg, var(--view-cube-surface-high), var(--view-cube-surface-low));
    box-shadow: inset 0 0 0 1px var(--view-cube-border);
  }
  .view-cube__body.has-active .view-cube__surface:not(.is-active):not(.is-hovered):not(:hover):not(:focus-visible) { opacity: .72; filter: saturate(.82) brightness(.92); }
  .view-cube__surface:not(:disabled):hover, .view-cube__surface.is-hovered, .view-cube__surface:focus-visible {
    z-index: 10; opacity: 1; border-color: color-mix(in oklch, var(--accent-primary) 88%, white);
    filter: brightness(1.3) saturate(1.16);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent-primary) 78%, white), inset 0 0 22px color-mix(in oklch, var(--accent-primary) 28%, transparent), 0 0 12px color-mix(in oklch, var(--accent-primary) 25%, transparent);
  }
  .view-cube__surface--face:not(:disabled):hover, .view-cube__surface--face.is-hovered, .view-cube__surface--face:focus-visible {
    background: linear-gradient(145deg, color-mix(in oklch, var(--accent-primary) 38%, var(--surface-elevated)), color-mix(in oklch, var(--accent-primary) 52%, var(--surface-sunken)));
  }
  .view-cube__surface.is-active {
    z-index: 8; opacity: 1; border-color: color-mix(in oklch, var(--accent-primary) 82%, white); filter: brightness(1.16) saturate(1.12);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent-primary) 66%, transparent), inset 0 0 20px color-mix(in oklch, var(--accent-primary) 24%, transparent), 0 0 9px color-mix(in oklch, var(--accent-primary) 16%, transparent);
  }
  .view-cube__surface--face.is-active { background: linear-gradient(145deg, color-mix(in oklch, var(--accent-primary) 30%, var(--surface-elevated)), color-mix(in oklch, var(--accent-primary) 43%, var(--surface-sunken))); }
  .view-cube__surface--edge:not(:disabled):hover, .view-cube__surface--edge.is-hovered,
  .view-cube__surface--corner:not(:disabled):hover, .view-cube__surface--corner.is-hovered,
  .view-cube__surface--edge.is-active, .view-cube__surface--corner.is-active { background: color-mix(in oklch, var(--accent-primary) 38%, var(--surface-elevated)); }
  .view-cube__label {
    pointer-events: none; display: inline-block; transform-origin: 50% 50%; white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, .42); will-change: transform;
  }
  .view-controls {
    width: 30px; height: 234px; margin-top: 2px; display: grid;
    grid-template-columns: 30px; grid-template-rows: repeat(7, 30px);
    gap: 4px; align-items: center; pointer-events: none;
  }
  .view-control-button {
    width: 30px; height: 30px; padding: 0; position: relative;
    border: 1px solid var(--view-cube-border); border-radius: 7px;
    color: var(--text-primary); background: var(--view-cube-panel);
    backdrop-filter: blur(12px); display: grid; place-items: center; cursor: pointer; pointer-events: auto;
    transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  }
  .view-control-button:not(:disabled):hover, .view-control-button:focus-visible {
    z-index: 30; border-color: color-mix(in oklch, var(--accent-primary) 82%, white);
    background: color-mix(in oklch, var(--surface-elevated) 84%, var(--accent-primary));
    box-shadow: 0 0 0 1px color-mix(in oklch, var(--accent-primary) 12%, transparent), 0 4px 14px rgba(0, 0, 0, .26); outline: none;
  }
  .view-control-button.is-active {
    border-color: color-mix(in oklch, var(--accent-primary) 88%, white);
    background: color-mix(in oklch, var(--surface-elevated) 72%, var(--accent-primary));
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent-primary) 28%, transparent), 0 0 10px color-mix(in oklch, var(--accent-primary) 18%, transparent);
  }
  .view-control-button:not(:disabled):active { transform: translateY(1px); }
  .view-control-button::after {
    content: attr(data-tooltip); position: absolute; top: 50%; right: calc(100% + 8px); transform: translate(3px, -50%);
    padding: 5px 7px; border: 1px solid rgba(255, 255, 255, .12); border-radius: 6px;
    color: #eef4fb; background: rgba(12, 16, 21, .96); box-shadow: 0 6px 18px rgba(0, 0, 0, .32);
    font: 600 11px/1 var(--font-sans); white-space: nowrap; pointer-events: none;
    opacity: 0; visibility: hidden; transition: opacity 100ms ease, transform 100ms ease, visibility 100ms ease;
  }
  .view-control-button:not(:disabled):hover::after, .view-control-button:focus-visible::after { opacity: 1; visibility: visible; transform: translate(0, -50%); }
  .home-view { grid-column: 1; grid-row: 1; }
  .left-view { grid-column: 1; grid-row: 2; }
  .right-view { grid-column: 1; grid-row: 3; }
  .top-view { grid-column: 1; grid-row: 4; }
  .bottom-view { grid-column: 1; grid-row: 5; }
  .front-view { grid-column: 1; grid-row: 6; }
  .back-view { grid-column: 1; grid-row: 7; }
  .view-control-button svg { width: 22px; height: 22px; pointer-events: none; overflow: visible; }
  .mini-cube { filter: drop-shadow(0 0 .55px rgba(255, 255, 255, .28)); }
  .mini-cube .face-highlight { fill: color-mix(in oklch, var(--accent-primary) 84%, #49b5f4); stroke: none; }
  .mini-cube .cube-edge { fill: none; stroke: currentColor; stroke-width: 1.45; stroke-linecap: round; stroke-linejoin: round; }
  .mini-cube .cube-hidden { fill: none; stroke: var(--text-muted); stroke-width: 1.05; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1.55 1.35; }
  .view-control-button .home-icon { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  button:disabled { cursor: default; }
  .disabled { opacity: .34; filter: grayscale(.48) drop-shadow(0 7px 12px rgba(0, 0, 0, .3)); }
</style>
