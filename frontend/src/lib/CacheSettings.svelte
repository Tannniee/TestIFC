<script lang="ts">
  import { onMount } from "svelte";
  import type { CacheInventory } from "./api-contracts";
  export let locale: "vi" | "en";
  export let busy = false;
  export let loadInventory: () => Promise<CacheInventory>;
  export let clearCache: (scope: "fragments" | "all") => Promise<CacheInventory & { freedBytes: number; failedFiles: number }>;
  let inventory: CacheInventory | null = null;
  let working = false;
  let message = "";
  const bytes = (value: number) => `${(value / 1024 ** 2).toFixed(1)} MB`;
  async function refresh() {
    try { inventory = await loadInventory(); }
    catch { message = locale === "vi" ? "Chưa kết nối cache." : "Cache is unavailable."; }
  }
  async function clear(scope: "fragments" | "all") {
    working = true;
    message = "";
    try {
      const result = await clearCache(scope);
      inventory = result;
      message = locale === "vi" ? `Đã dọn ${bytes(result.freedBytes)}. Giữ lại ${result.protectedModels} model đang sử dụng.` : `Cleared ${bytes(result.freedBytes)}. Kept ${result.protectedModels} models in use.`;
      if (result.failedFiles) message += locale === "vi" ? ` ${result.failedFiles} tệp chưa xóa được.` : ` ${result.failedFiles} files could not be removed.`;
    } catch (error) { message = String(error); }
    finally { working = false; }
  }
  onMount(() => { void refresh(); });
</script>

<section class="cache-settings" aria-label="Model cache">
  <strong>Model cache</strong>
  {#if inventory}
    <p>{bytes(inventory.totalBytes)} · Fragment: {bytes(inventory.fragmentBytes)}</p>
    <p>{locale === "vi" ? "Tự dọn:" : "Retention:"} {inventory.keepModels} model / {bytes(inventory.maxBytes)}</p>
  {/if}
  <div><button disabled={busy || working || !inventory} onclick={() => clear("fragments")}>Clear fragment cache</button>
    <button disabled={busy || working || !inventory} onclick={() => clear("all")}>Clear model cache</button></div>
  <p>{locale === "vi" ? "Giữ model đang dùng. File IFC gốc không bị xóa." : "Keeps models in use. Original IFC files are preserved."}</p>
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  .cache-settings { padding: 10px 0; border-bottom: 1px solid var(--border-subtle); margin-bottom: 10px; font-size: 11px; }
  strong { font-size: 12px; }
  .cache-settings { font-family: var(--font-sans); }
  p { margin: 5px 0; color: var(--text-secondary); line-height: 1.4; }
  div { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  button { padding: 6px 8px; border: 1px solid var(--border-default); border-radius: 5px; background: var(--surface-overlay); color: var(--text-primary); font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
</style>
