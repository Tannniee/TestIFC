<script lang="ts">
  import type { SectionBoxState } from "./viewer-contracts";
  import { validSectionBox } from "./viewer-clipping";
  export let box: SectionBoxState;
  export let locale: "vi" | "en";
  export let onChange: (box: SectionBoxState) => void;
  export let onDraw: () => void;
  export let onFit: () => void;
  export let onReset: () => void;
  export let onClose: () => void;
  export let embedded = false;
  const axes = [{ label: "X", key: "x", sign: 1 }, { label: "Y", key: "z", sign: -1 }, { label: "Z", key: "y", sign: 1 }] as const;
  let invalid = false;
  function change(key: "x" | "y" | "z", side: "min" | "max", sign: number, value: number) {
    const next = structuredClone(box);
    const target = sign === 1 ? side : side === "min" ? "max" : "min";
    next[target][key] = value * sign;
    invalid = !validSectionBox(next);
    if (!invalid) onChange(next);
  }
</script>

<section class="viewer-section-box-panel" class:embedded aria-label="Section Box">
  <header><strong>Section Box · m</strong>{#if !embedded}<button aria-label={locale === "vi" ? "Đóng bảng Section Box" : "Close Section Box panel"} onclick={onClose}>×</button>{/if}</header>
  <label class="enable"><input type="checkbox" checked={box.enabled} onchange={e => onChange({ ...box, enabled: e.currentTarget.checked })} />{locale === "vi" ? "Bật vùng cắt" : "Enable clipping"}</label>
  <div class="bounds">
    <span></span><span>Min</span><span>Max</span>
    {#each axes as axis}
      <strong>{axis.label}</strong>
      {#each ["min", "max"] as side}
        <input aria-label={`Section Box ${axis.label} ${side}`} type="number" step="any"
          value={Number((box[axis.sign === 1 ? side as "min" | "max" : side === "min" ? "max" : "min"][axis.key] * axis.sign).toFixed(4))}
          onchange={e => change(axis.key, side as "min" | "max", axis.sign, e.currentTarget.valueAsNumber)} />
      {/each}
    {/each}
  </div>
  {#if invalid}<p role="alert">{locale === "vi" ? "Min phải nhỏ hơn Max." : "Min must be less than Max."}</p>{/if}
  <footer><button onclick={onDraw}>{locale === "vi" ? "Quét lại" : "Draw again"}</button><button onclick={onFit}>Fit View</button><button onclick={onReset}>Reset Bounds</button></footer>
</section>

<style>
  .viewer-section-box-panel { position: absolute; z-index: 24; left: 16px; top: calc(var(--workspace-top, 0px) + 16px); width: min(290px, calc(100% - 32px)); padding: 12px; background: var(--surface-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 12px; box-shadow: 0 8px 24px #0003; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .viewer-section-box-panel { font-family: var(--font-sans); }
  .viewer-section-box-panel.embedded { position: static; width: auto; max-width: none; box-shadow: none; border: 0; padding: 12px 0; }
  header button { border: 0; background: transparent; font-size: 18px; }
  .enable { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
  .bounds { display: grid; grid-template-columns: 18px minmax(0,1fr) minmax(0,1fr); align-items: center; gap: 6px; }
  input[type="number"] { width: 100%; min-width: 0; padding: 5px; border: 1px solid var(--border-default); border-radius: 4px; background: var(--surface-sunken); color: inherit; font: inherit; }
  footer { display: flex; gap: 6px; margin-top: 10px; }
  button { color: inherit; cursor: pointer; }
  footer button { flex: 1; padding: 6px 4px; border: 1px solid var(--border-default); border-radius: 4px; background: var(--surface-overlay); font-size: 11px; }
  p { color: var(--state-warning); }
</style>
