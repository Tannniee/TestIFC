<script lang="ts">
  import * as THREE from "three";
  import type { CameraOrientation, ViewDirection } from "./viewer";

  type Vec3 = readonly [number, number, number];
  type SurfaceKind = "face" | "edge" | "corner";
  type Axis = "x" | "y" | "z";

  interface ViewCubeText {
    viewCube: string;
    directions: string;
    quickViews: string;
    viewFrom: string;
    edge: string;
    corner: string;
    left: string;
    right: string;
    back: string;
    front: string;
    top: string;
    bottom: string;
    homeIso: string;
  }

  interface Surface {
    key: string;
    kind: SurfaceKind;
    direction: ViewDirection;
    label: string;
    width: number;
    height: number;
    transform: string;
    axis?: Axis;
    originY?: number;
    clipPath?: string;
    basisU?: Vec3;
    basisV?: Vec3;
  }

  interface QuickView {
    className: string;
    direction: ViewDirection;
    highlight: string;
  }

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

  const SIZE = 96;
  const HALF = SIZE / 2;
  const BEVEL = 14;
  const FACE_SIZE = SIZE - BEVEL * 2;
  const EDGE_DEPTH = BEVEL * Math.SQRT2;
  const CORNER_SIDE = BEVEL * Math.SQRT2;
  const CORNER_HEIGHT = CORNER_SIDE * Math.sqrt(3) / 2;

  const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const multiply = (a: Vec3, value: number): Vec3 => [a[0] * value, a[1] * value, a[2] * value];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const vectorLength = (value: Vec3) => Math.hypot(value[0], value[1], value[2]);

  function normalize(value: Vec3): Vec3 {
    const length = vectorLength(value);
    return length === 0 ? [0, 0, 0] : [value[0] / length, value[1] / length, value[2] / length];
  }

  // The CSS cube uses a Y-up scene, while the navigation labels use the
  // engineering Z-up convention: (X, Y, Z) -> (X, Z, -Y).
  const engineeringToCube = (value: Vec3): Vec3 => [value[0], value[2], -value[1]];
  const worldToCss = (value: Vec3): Vec3 => [value[0], -value[1], value[2]];

  function formatNumber(value: number) {
    if (Math.abs(value) < 0.000001) return "0";
    return value.toFixed(6).replace(/\.?0+$/, "");
  }

  function makeSurfaceBasis(normalWorld: Vec3, preferredUWorld: Vec3) {
    const normal = normalize(worldToCss(normalWorld));
    let preferredU = worldToCss(preferredUWorld);
    preferredU = subtract(preferredU, multiply(normal, dot(preferredU, normal)));
    let u = normalize(preferredU);
    if (vectorLength(u) < 0.001) {
      const fallback: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      u = normalize(subtract(fallback, multiply(normal, dot(fallback, normal))));
    }
    const v = normalize(cross(normal, u));
    return { u, v, normal };
  }

  function makeSurfaceMatrix(centerWorld: Vec3, normalWorld: Vec3, preferredUWorld: Vec3) {
    const center = worldToCss(centerWorld);
    const { u, v, normal } = makeSurfaceBasis(normalWorld, preferredUWorld);
    return `matrix3d(${[
      u[0], u[1], u[2], 0,
      v[0], v[1], v[2], 0,
      normal[0], normal[1], normal[2], 0,
      center[0], center[1], center[2], 1,
    ].map(formatNumber).join(",")})`;
  }

  const directionKey = (direction: ViewDirection) => `${direction.x}:${direction.y}:${direction.z}`;

  function axisDirectionLabel(direction: ViewDirection) {
    const result: string[] = [];
    if (direction.x === 1) result.push("+X");
    if (direction.x === -1) result.push("−X");
    if (direction.y === 1) result.push("+Y");
    if (direction.y === -1) result.push("−Y");
    if (direction.z === 1) result.push("+Z");
    if (direction.z === -1) result.push("−Z");
    return result.join(" / ");
  }

  function viewNames(direction: ViewDirection) {
    const result: string[] = [];
    if (direction.z === 1) result.push(text.top);
    if (direction.z === -1) result.push(text.bottom);
    if (direction.y === -1) result.push(text.front);
    if (direction.y === 1) result.push(text.back);
    if (direction.x === -1) result.push(text.left);
    if (direction.x === 1) result.push(text.right);
    return result;
  }

  function surfaceName(surface: Surface) {
    const names = viewNames(surface.direction).join(" / ");
    if (surface.kind === "face") return names;
    return `${surface.kind === "edge" ? text.edge : text.corner}: ${names}`;
  }

  function makeFace(direction: ViewDirection, axis: Axis, preferredU: Vec3, label: string): Surface {
    const normal = engineeringToCube([direction.x, direction.y, direction.z]);
    const preferredCubeU = engineeringToCube(preferredU);
    const { u, v } = makeSurfaceBasis(normal, preferredCubeU);
    return {
      key: directionKey(direction), kind: "face", direction, label, axis,
      width: FACE_SIZE, height: FACE_SIZE,
      transform: makeSurfaceMatrix(multiply(normal, HALF), normal, preferredCubeU),
      basisU: u, basisV: v,
    };
  }

  const faces: Surface[] = [
    makeFace({ x: 1, y: 0, z: 0 }, "x", [0, 0, -1], "RIGHT"),
    makeFace({ x: -1, y: 0, z: 0 }, "x", [0, 0, 1], "LEFT"),
    makeFace({ x: 0, y: 1, z: 0 }, "y", [1, 0, 0], "BACK"),
    makeFace({ x: 0, y: -1, z: 0 }, "y", [1, 0, 0], "FRONT"),
    makeFace({ x: 0, y: 0, z: 1 }, "z", [1, 0, 0], "TOP"),
    makeFace({ x: 0, y: 0, z: -1 }, "z", [-1, 0, 0], "BOTTOM"),
  ];

  function makeEdge(direction: ViewDirection): Surface {
    const cubeDirection = engineeringToCube([direction.x, direction.y, direction.z]);
    const normal = normalize(cubeDirection);
    const coordinate = HALF - BEVEL / 2;
    const center: Vec3 = [
      cubeDirection[0] === 0 ? 0 : cubeDirection[0] * coordinate,
      cubeDirection[1] === 0 ? 0 : cubeDirection[1] * coordinate,
      cubeDirection[2] === 0 ? 0 : cubeDirection[2] * coordinate,
    ];
    const preferredEngineering: Vec3 = direction.x === 0 ? [1, 0, 0] : direction.y === 0 ? [0, 1, 0] : [0, 0, 1];
    return {
      key: directionKey(direction), kind: "edge", direction,
      label: axisDirectionLabel(direction), width: FACE_SIZE, height: EDGE_DEPTH,
      transform: makeSurfaceMatrix(center, normal, engineeringToCube(preferredEngineering)),
    };
  }

  const edges: Surface[] = [];
  for (const x of [-1, 1] as const) for (const y of [-1, 1] as const) edges.push(makeEdge({ x, y, z: 0 }));
  for (const x of [-1, 1] as const) for (const z of [-1, 1] as const) edges.push(makeEdge({ x, y: 0, z }));
  for (const y of [-1, 1] as const) for (const z of [-1, 1] as const) edges.push(makeEdge({ x: 0, y, z }));

  function makeCorner(direction: ViewDirection): Surface {
    const [sx, sy, sz] = engineeringToCube([direction.x, direction.y, direction.z]);
    const a: Vec3 = [sx * HALF, sy * (HALF - BEVEL), sz * (HALF - BEVEL)];
    const b: Vec3 = [sx * (HALF - BEVEL), sy * HALF, sz * (HALF - BEVEL)];
    const c: Vec3 = [sx * (HALF - BEVEL), sy * (HALF - BEVEL), sz * HALF];
    const center = multiply(add(add(a, b), c), 1 / 3);
    const normal = normalize([sx, sy, sz]);
    const preferredU = normalize(subtract(b, a));
    const { v } = makeSurfaceBasis(normal, preferredU);
    const apexIsTop = dot(subtract(worldToCss(c), worldToCss(center)), v) < 0;
    return {
      key: directionKey(direction), kind: "corner", direction,
      label: axisDirectionLabel(direction), width: CORNER_SIDE, height: CORNER_HEIGHT,
      originY: apexIsTop ? 2 / 3 : 1 / 3,
      clipPath: apexIsTop ? "polygon(50% 0, 100% 100%, 0 100%)" : "polygon(0 0, 100% 0, 50% 100%)",
      transform: makeSurfaceMatrix(center, normal, preferredU),
    };
  }

  const corners: Surface[] = [];
  for (const x of [-1, 1] as const) for (const y of [-1, 1] as const) {
    for (const z of [-1, 1] as const) corners.push(makeCorner({ x, y, z }));
  }
  const surfaces = [...faces, ...edges, ...corners];

  const quickViews: QuickView[] = [
    { className: "left-view", direction: { x: -1, y: 0, z: 0 }, highlight: "4.5,8 9,4 9,15.5 4.5,20" },
    { className: "right-view", direction: { x: 1, y: 0, z: 0 }, highlight: "15,8 19.5,4 19.5,15.5 15,20" },
    { className: "top-view", direction: { x: 0, y: 0, z: 1 }, highlight: "4.5,8 9,4 19.5,4 15,8" },
    { className: "bottom-view", direction: { x: 0, y: 0, z: -1 }, highlight: "4.5,20 9,15.5 19.5,15.5 15,20" },
    { className: "front-view", direction: { x: 0, y: -1, z: 0 }, highlight: "4.5,8 15,8 15,20 4.5,20" },
    { className: "back-view", direction: { x: 0, y: 1, z: 0 }, highlight: "9,4 19.5,4 19.5,15.5 9,15.5" },
  ];

  const DRAG_THRESHOLD = 6;
  const ORBIT_RADIANS_PER_PIXEL = Math.PI / 260;
  const ISO_DIRECTION = new THREE.Vector3(8, 6, 8).normalize();

  let hoveredKey: string | null = null;
  let pointerId: number | null = null;
  let pressedDirection: ViewDirection | null = null;
  let previousPointerX = 0;
  let previousPointerY = 0;
  let totalDragDistance = 0;
  let dragged = false;

  function cssRotationMatrix(value: CameraOrientation) {
    const inverseCamera = new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion(value.x, value.y, value.z, value.w).normalize().invert(),
    );
    const flipY = new THREE.Matrix4().makeScale(1, -1, 1);
    return flipY.clone().multiply(inverseCamera).multiply(flipY);
  }

  function orientationTransform(value: CameraOrientation) {
    return `matrix3d(${cssRotationMatrix(value).elements.map(formatNumber).join(",")})`;
  }

  function faceLabelTransform(surface: Surface, value: CameraOrientation) {
    if (!surface.basisU || !surface.basisV) return undefined;
    const rotation = new THREE.Matrix3().setFromMatrix4(cssRotationMatrix(value));
    const ru = new THREE.Vector3(...surface.basisU).applyMatrix3(rotation);
    const rv = new THREE.Vector3(...surface.basisV).applyMatrix3(rotation);
    let angle = Math.atan2(-ru.y, rv.y);
    const projectedX = ru.x * Math.cos(angle) + rv.x * Math.sin(angle);
    if (projectedX < 0) angle += Math.PI;
    return `rotate(${angle}rad)`;
  }

  function currentDirectionKey(value: CameraOrientation) {
    const cameraDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion(value.x, value.y, value.z, value.w).normalize(),
    );
    const engineeringDirection: Vec3 = [cameraDirection.x, -cameraDirection.z, cameraDirection.y];
    let closest: Surface | null = null;
    let closestDot = -1;
    for (const surface of surfaces) {
      const direction = normalize([surface.direction.x, surface.direction.y, surface.direction.z]);
      const similarity = dot(engineeringDirection, direction);
      if (similarity > closestDot) { closest = surface; closestDot = similarity; }
    }
    return closestDot >= 0.985 ? closest?.key ?? null : null;
  }

  function isIsoOrientation(value: CameraOrientation) {
    const cameraDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion(value.x, value.y, value.z, value.w).normalize(),
    );
    return cameraDirection.dot(ISO_DIRECTION) > 0.9995;
  }

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
    if (totalDragDistance <= DRAG_THRESHOLD) return;
    dragged = true;
    hoveredKey = null;
    event.preventDefault();
    onOrbit(deltaX * ORBIT_RADIANS_PER_PIXEL, deltaY * ORBIT_RADIANS_PER_PIXEL);
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

  const surfaceClass = (surface: Surface) => `view-cube__surface view-cube__surface--${surface.kind}`;
  function surfaceStyle(surface: Surface) {
    const originY = surface.originY ?? 0.5;
    return [
      `width:${surface.width}px`, `height:${surface.height}px`,
      `margin-left:${-surface.width / 2}px`, `margin-top:${-surface.height * originY}px`,
      `transform-origin:50% ${originY * 100}%`, `transform:${surface.transform}`,
      surface.clipPath ? `clip-path:${surface.clipPath}` : "",
    ].filter(Boolean).join(";");
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
              aria-label={`${text.viewFrom} ${surfaceName(surface)}`}
              title={surfaceName(surface)}
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
        aria-label={`${text.viewFrom} ${viewNames(quickView.direction).join(" / ")}`}
        data-tooltip={viewNames(quickView.direction).join(" / ")}
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
