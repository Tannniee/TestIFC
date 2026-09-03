<script lang="ts">
  import type { BridgeProgress } from "./viewer-contracts";
  let { progress, text, locale, onRetry }: { progress: BridgeProgress | null; text: string; locale: "vi" | "en"; onRetry: () => Promise<void> } = $props();
  const phases: Record<string, [string, string]> = {
    queued: ["Chờ worker", "Waiting for worker"], store: ["Chuẩn bị dữ liệu IFC", "Preparing IFC store"],
    opening: ["Đang đọc IFC", "Opening IFC"], hot: ["Cấu kiện & cây mô hình", "Elements & model tree"],
    cold: ["Thuộc tính & khối lượng", "Properties & quantities"], ready: ["Hoàn tất", "Complete"],
  };
  let busy = $state(false);
  const data = $derived(progress?.semantic);
  const active = $derived(progress && ["indexing_hot", "indexing_cold", "stalled"].includes(progress.stage));
  const label = $derived(data ? phases[data.phase]?.[locale === "vi" ? 0 : 1] ?? data.phase : "");
  async function retry() { if (busy) return; busy = true; try { await onRetry(); } finally { busy = false; } }
</script>

<div class="semantic-status" class:stalled={progress?.stage === "stalled"} title={progress?.detail}>
  <div class="semantic-status__text" aria-live="polite">
    <span>{text}</span>
    {#if active && data}
      <small>{label} · {data.completed.toLocaleString(locale)}{data.total !== null ? ` / ${data.total.toLocaleString(locale)}` : ""}{data.total ? ` (${Math.min(100, Math.round(data.completed / data.total * 100))}%)` : ""}{data.category ? ` · ${data.category}` : ""}</small>
      {#if data.stalled}<small>{locale === "vi" ? "Không có tiến triển" : "No progress for"} {Math.floor(data.idleSeconds)}s</small>{/if}
      {#if data.total}<progress max={data.total} value={data.completed} aria-label="Semantic index progress"></progress>
      {:else}<progress aria-label="Semantic index progress"></progress>{/if}
    {/if}
  </div>
  {#if progress?.canRetry}<button disabled={busy} onclick={retry}>{locale === "vi" ? "Thử lại" : "Retry"}</button>{/if}
</div>

<style>
  .semantic-status { display:flex; align-items:center; gap:8px; min-width:0; flex:1; max-width:540px; padding:5px 0; }
  .semantic-status__text { min-width:0; flex:1; display:grid; gap:3px; }
  span, small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  small { font-size:10px; opacity:.85; }
  progress { height:4px; width:100%; accent-color:var(--accent-primary); }
  .stalled { color:var(--color-warning, #dba32c); }
  button { flex-shrink:0; padding:4px 9px; border:1px solid currentColor; border-radius:5px; color:inherit; background:transparent; cursor:pointer; font:inherit; }
  button:disabled { opacity:.6; cursor:wait; }
</style>
