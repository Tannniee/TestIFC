<script lang="ts">
  import { onMount } from "svelte";
  import type { CacheInventory } from "./api-contracts";
  export let locale: "vi" | "en";
  export let busy = false;
  export let loadInventory: () => Promise<CacheInventory>;
  export let clearCache: (scope: "fragments" | "all") => Promise<CacheInventory & { freedBytes: number; failedFiles: number }>;
  let inventory: CacheInventory | null = null;
  let working = false;
  let status: "" | "unavailable" | "cleared" | "failed" = "";
  let freedBytes=0,protectedModels=0,failedFiles=0;
  const bytes = (value: number) => `${(value / 1024 ** 2).toFixed(1)} MB`;
  $: message=status==='unavailable'?(locale==='vi'?'Chưa kết nối bộ nhớ mô hình.':'Cache is unavailable.')
    :status==='failed'?(locale==='vi'?'Chưa dọn được bộ nhớ. Hãy thử lại.':'Could not clear the cache. Retry.')
    :status==='cleared'?(locale==='vi'?`Đã dọn ${bytes(freedBytes)}. Giữ lại ${protectedModels} mô hình đang sử dụng.`:`Cleared ${bytes(freedBytes)}. Kept ${protectedModels} models in use.`)
      +(failedFiles?(locale==='vi'?` ${failedFiles} tệp chưa xóa được.`:` ${failedFiles} files could not be removed.`):''):'';
  async function refresh() {
    try { inventory = await loadInventory(); }
    catch { status='unavailable'; }
  }
  async function clear(scope: "fragments" | "all") {
    working = true;
    status = "";
    try {
      const result = await clearCache(scope);
      inventory = result;
      freedBytes=result.freedBytes;protectedModels=result.protectedModels;failedFiles=result.failedFiles;status='cleared';
    } catch { status='failed'; }
    finally { working = false; }
  }
  onMount(() => { void refresh(); });
</script>

<section class="cache-settings" aria-label={locale === "vi" ? "Bộ nhớ mô hình" : "Model cache"}>
  <strong>{locale === "vi" ? "Bộ nhớ mô hình" : "Model cache"}</strong>
  {#if inventory}
    <p>{bytes(inventory.totalBytes)} · Fragment: {bytes(inventory.fragmentBytes)}</p>
    <p>{locale === "vi" ? "Tự dọn:" : "Retention:"} {inventory.keepModels} {locale === "vi" ? "mô hình" : "models"} / {bytes(inventory.maxBytes)}</p>
  {/if}
  <div><button disabled={busy || working || !inventory} onclick={() => clear("fragments")}>{locale === "vi" ? "Dọn bộ nhớ hình học" : "Clear fragment cache"}</button>
    <button disabled={busy || working || !inventory} onclick={() => clear("all")}>{locale === "vi" ? "Dọn bộ nhớ mô hình" : "Clear model cache"}</button></div>
  <p>{locale === "vi" ? "Giữ mô hình đang dùng. Tệp IFC gốc không bị xóa." : "Keeps models in use. Original IFC files are preserved."}</p>
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
