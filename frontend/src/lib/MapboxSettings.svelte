<script lang="ts">
  import { normalizeMapboxToken, testMapboxToken } from "./mapbox-token";
  import type { Locale } from "./i18n";
  export let token: string;
  export let locale: Locale;
  export let onSave: (token: string) => void;
  let draft = token, previous = token, testing = false, resultCode: "" | "valid" | "rejected" | "offline" | "saved" | "deleted" = "", showToken = false;
  $: if (token !== previous) { previous = token; draft = token; resultCode = ""; }
  $: vi = locale === "vi";
  $: result = {"":"",valid:vi?"Key hợp lệ · Light v10 tải được":"Valid key · Light v10 available",rejected:vi?"Key bị từ chối hoặc thiếu quyền truy cập":"Key rejected or missing access",offline:vi?"Không kết nối được Mapbox. Kiểm tra mạng và quyền URL của key.":"Cannot reach Mapbox. Check network and token URL restrictions.",saved:vi?"Đã lưu key":"Key saved",deleted:vi?"Đã xóa key":"Key deleted"}[resultCode];
  async function test() {
    const candidate = normalizeMapboxToken(draft);
    testing = true; resultCode = "";
    try {
      const accepted = await testMapboxToken(candidate);
      if (normalizeMapboxToken(draft) === candidate) resultCode = accepted ? "valid" : "rejected";
    }
    catch { if(normalizeMapboxToken(draft)===candidate) resultCode="offline"; }
    finally { testing = false; }
  }
</script>
<fieldset class="mapbox-settings">
  <legend>Mapbox</legend>
  <label for="mapbox-token">{vi ? "Token công khai (pk.)" : "Public access token (pk.)"}</label>
  <input id="mapbox-token" type={showToken ? "text" : "password"} autocomplete="off" spellcheck="false" bind:value={draft} placeholder="pk.…" oninput={() => resultCode = ""} />
  <p>{vi ? "Token lưu trên máy này. Có thể thay hoặc xóa bất cứ lúc nào." : "Stored on this device. Replace or delete it at any time."}</p>
  <div class="actions">
    <button aria-pressed={showToken} onclick={() => showToken = !showToken}>{showToken ? (vi ? "Ẩn key" : "Hide key") : (vi ? "Hiện key" : "Show key")}</button>
    <button disabled={testing || !normalizeMapboxToken(draft)} onclick={test}>{testing ? "…" : vi ? "Kiểm tra key" : "Test key"}</button>
    <button disabled={!normalizeMapboxToken(draft) || testing} onclick={() => { onSave(normalizeMapboxToken(draft)); resultCode="saved"; }}>{vi ? "Lưu key" : "Save key"}</button>
    <button disabled={!token || testing} onclick={() => { onSave(""); draft = ""; resultCode="deleted"; }}>{vi ? "Xóa key" : "Delete key"}</button>
  </div>
  <p role="status">{result}</p>
</fieldset>
<style>
  .mapbox-settings{border:0;padding:12px 0;margin:0;font-size:12px}
  input{box-sizing:border-box;width:100%;margin-top:8px;background:var(--surface-elevated,#fff);color:inherit;border:1px solid var(--border-default);border-radius:5px;padding:8px}
  p{opacity:.8;line-height:1.4}.actions{display:flex;gap:6px;flex-wrap:wrap}button{font:inherit;padding:6px 8px;border:1px solid var(--border-default);border-radius:5px;background:var(--surface-overlay);color:inherit;cursor:pointer;transition:background-color 180ms,border-color 180ms}button:disabled{opacity:.4;cursor:default}
</style>
