<script lang="ts">
  import { onMount } from "svelte";
  import type { GisAnchorResponse, ManualAnchor } from "./api-contracts";
  import type { Locale } from "./i18n";
  export let token: string;
  export let modelHash: string;
  export let file: File | null;
  export let filename: string;
  export let visible: boolean;
  export let locale: Locale;
  export let onSettings: () => void;
  export let onViewer: () => void;
  export let onRead: (hash: string) => Promise<GisAnchorResponse>;
  export let onSave: (hash: string, anchor: ManualAnchor) => Promise<GisAnchorResponse>;
  let frame: HTMLIFrameElement, ready = false, loaded = false, busy = false, editing = false, saving = false;
  let markerVisible = true, error = "", mapError = "", status = "", frameRevision = 0;
  let sentHash: string | null = null, sentToken: string | null = null;
  const defaultAnchor: ManualAnchor = { longitude:106.701,latitude:10.775,elevationMeters:0,rotationDegrees:0,scale:1 };
  let saved: ManualAnchor = { ...defaultAnchor }, draft: ManualAnchor = { ...defaultAnchor };
  const channel = "testifc-bim-gis-v1";
  $: vi = locale === "vi";
  $: valid = [draft.longitude,draft.latitude,draft.elevationMeters,draft.rotationDegrees,draft.scale].every(Number.isFinite)
    && Math.abs(draft.longitude)<=180 && Math.abs(draft.latitude)<=85 && draft.scale>0 && draft.scale<=1000;
  function send(type: string, data: Record<string, unknown> = {}) { frame?.contentWindow?.postMessage({ channel, type, ...data }, location.origin); }
  // A new IFC tears down the converter iframe, terminating its workers. Token
  // changes stay inside the same iframe and keep its glTF scene and map camera.
  $: if (ready && modelHash !== sentHash) { if (sentHash !== null) reset(); else void initializeDocument(); }
  $: if (ready && token !== sentToken) { sentToken = token; send("token", { token }); }
  $: if (ready && visible) send("resize");
  function reset() {
    ready=false; loaded=false; busy=false; editing=false; saving=false; error=""; mapError=""; status="";
    sentHash=null; sentToken=null; frameRevision++;
  }
  async function initializeDocument() {
    const hash = modelHash; sentHash=hash; loaded=false; error=""; editing=false; saved={...defaultAnchor}; draft={...saved};
    if (hash) {
      try { const response=await onRead(hash); if (hash!==modelHash) return; if(response.anchor) saved={...response.anchor}; }
      catch { error=vi ? "Không đọc được vị trí đã lưu. Bạn vẫn có thể đặt và thử lưu lại." : "Saved placement unavailable. You can place the model and retry saving."; }
    }
    if(hash!==modelHash || !ready) return;
    draft={...saved}; send("anchor",{anchor:draft});
    busy=Boolean(hash && file); status=busy ? (vi ? "Đang chuyển IFC → glTF + JSON…" : "Converting IFC → glTF + JSON…") : "";
    send("document",{hash,file});
  }
  $: if (ready && editing && valid) send("anchor", { anchor: draft });
  function preview() { if(valid) send("anchor",{anchor:draft}); }
  function edit() { editing=true; error=""; send("pick",{enabled:true}); send("fly"); }
  function cancel() { draft={...saved}; editing=false; error=""; send("pick",{enabled:false}); preview(); }
  async function save() {
    if(!valid || saving) return;
    const hash=modelHash, anchor={...draft}; saving=true; error="";
    try { const response=await onSave(hash,anchor); if(hash!==modelHash) return; if(!response.anchor) throw new Error("Missing saved placement"); saved={...response.anchor}; draft={...saved}; editing=false; send("pick",{enabled:false}); preview(); status=vi?"Đã lưu vị trí thủ công":"Manual placement saved"; }
    catch { if(hash===modelHash) error=vi?"Không lưu được vị trí. Kiểm tra kết nối bridge rồi thử lại.":"Cannot save placement. Check the bridge and retry."; }
    finally { if(hash===modelHash) saving=false; }
  }
  onMount(() => {
    const receive=(event: MessageEvent)=>{
      if(event.source!==frame?.contentWindow || event.origin!==location.origin || event.data?.channel!==channel) return;
      const data=event.data;
      if(data.type==="ready") ready=true;
      if(data.type==="map-ready") mapError="";
      if(data.type==="map-error") mapError=data.message;
      if(data.type==="picked" && editing) draft={...data.anchor};
      if(data.hash && data.hash!==modelHash) return;
      if(data.type==="progress") status=`${data.stage} · ${Math.round(Math.min(1,Math.max(0,data.progress))*100)}%`;
      if(data.type==="model-ready") { loaded=true;busy=false;status=vi?`IFC sẵn sàng${data.cached?" · cache":""} · glTF + JSON`:`IFC ready${data.cached?" · cached":""} · glTF + JSON`; }
      if(data.type==="model-error") { busy=false;error=data.message; }
      if(data.type==="cache-warning") error=data.message;
    };
    window.addEventListener("message",receive);
    const observer=new ResizeObserver(()=>send("resize")); observer.observe(frame.parentElement!);
    return ()=>{ window.removeEventListener("message",receive);observer.disconnect(); };
  });
</script>
<section class="mapbox-workspace" class:hidden={!visible} aria-label="BIM–GIS Mapbox">
  {#key frameRevision}<iframe bind:this={frame} src="/vendor/bim-gis/index.html" title="Mapbox BIM–GIS" allow="" onload={() => { /* runtime ready handshake */ }}></iframe>{/key}
  <div class="map-controls">
    <header><strong>BIM–GIS</strong><button onclick={onViewer}>{vi?"Về IFC viewer":"IFC viewer"}</button></header>
    {#if !token}<p>{vi?"Thêm public token để mở Mapbox.":"Add a public token to open Mapbox."}</p><button onclick={onSettings}>{vi?"Mở Cài đặt Mapbox":"Mapbox settings"}</button>{/if}
    <p class="filename">{filename || (vi?"Mở một file IFC để đặt trên bản đồ":"Open one IFC to place on the map")}</p>
    <div class="buttons">
      <button disabled={!token || !loaded} onclick={() => send("fly")}>{vi?"Bay tới mô hình":"Fly to model"}</button>
      <button disabled={!token} onclick={() => send("globe")}>{vi?"Về địa cầu":"Back to space"}</button>
      <button disabled={!token || !loaded || saving} onclick={edit}>{vi?"Đặt / xoay IFC":"Place / rotate IFC"}</button>
      <button disabled={!token || !loaded || saving} onclick={() => { draft={...draft,longitude:Math.random()*360-180,latitude:Math.random()*140-70};preview();edit(); }}>{vi?"Thử vị trí ngẫu nhiên":"Move randomly"}</button>
      <button disabled={!token || !modelHash} onclick={() => { markerVisible=!markerVisible;send("marker",{visible:markerVisible}); }}>{markerVisible?(vi?"Ẩn marker":"Hide marker"):(vi?"Hiện marker":"Show marker")}</button>
    </div>
    {#if editing}
      <p>{vi?"Bấm lên bản đồ để đặt pin. Kéo chuột phải để xoay bản đồ.":"Click the map to place the pin. Right-drag to rotate the map."}</p>
      <div class="fields">
        <label>{vi?"Kinh độ":"Longitude"}<input type="number" step="any" bind:value={draft.longitude} /></label>
        <label>{vi?"Vĩ độ":"Latitude"}<input type="number" step="any" bind:value={draft.latitude} /></label>
        <label>{vi?"Xoay IFC (°)":"IFC yaw (°)"}<input type="number" step="1" bind:value={draft.rotationDegrees} /></label>
        <label>{vi?"Cao độ (m)":"Elevation (m)"}<input type="number" step="any" bind:value={draft.elevationMeters} /></label>
        <label>{vi?"Tỷ lệ":"Scale"}<input type="number" min="0.001" max="1000" step="0.1" bind:value={draft.scale} /></label>
      </div>
      <div class="buttons"><button disabled={!valid || saving} onclick={save}>{saving?"…":vi?"Lưu vị trí":"Save placement"}</button><button disabled={saving} onclick={cancel}>{vi?"Hủy":"Cancel"}</button></div>
      <small>{vi?"Vị trí thủ công · chưa xác minh tọa độ khảo sát":"Manual placement · survey coordinates unverified"}</small>
    {/if}
    <p class="status" role="status">{status}</p>
    {#if busy}<progress aria-label="IFC → glTF"></progress>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{#if !busy}<button onclick={reset}>{vi?"Thử lại IFC":"Retry IFC"}</button>{/if}{/if}
    {#if mapError}<p class="error" role="alert">{mapError}</p><button onclick={onSettings}>{vi?"Kiểm tra key":"Check key"}</button>{/if}
  </div>
</section>
<svelte:window onkeydown={event => { if(event.key === "Escape" && visible && editing && !saving) { event.preventDefault(); cancel(); } }} />
<style>
  .mapbox-workspace{position:absolute;inset:var(--workspace-top,34px) 0 32px;z-index:2;background:#101b30}.hidden{display:none}
  iframe{width:100%;height:100%;border:0}.map-controls{position:absolute;left:12px;top:12px;width:280px;max-height:calc(100% - 52px);overflow:auto;padding:12px;box-sizing:border-box;border-radius:10px;background:var(--surface-elevated,#fff);color:var(--text-primary,#18212f);box-shadow:0 8px 28px #0003;font-size:12px}
  header{display:flex;align-items:center;justify-content:space-between;gap:8px}.filename{overflow-wrap:anywhere;opacity:.8}.buttons{display:flex;gap:6px;flex-wrap:wrap}
  button{padding:7px 9px;border:1px solid #8884;border-radius:6px;background:#347ff3;color:#fff;font:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}
  .fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.fields label{display:flex;flex-direction:column;gap:4px}input{width:100%;box-sizing:border-box;padding:6px;border:1px solid #8886;border-radius:4px;background:transparent;color:inherit;font:inherit}.error{color:#d24949;line-height:1.5}p{line-height:1.5}small{display:block;margin-top:10px;opacity:.7}progress{width:100%}.status{opacity:.8}
</style>
