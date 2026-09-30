<script lang="ts">
  import { onMount } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Icon from "./Icon.svelte";
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
  type Mode = "none" | "place" | "align" | "rotate";
  let frame: HTMLIFrameElement, ready=false, loaded=false, busy=false, editing=false, saving=false;
  let mode: Mode="none", markerVisible=true, showUnderground=false, fullDetails=false, error="", mapError="", status="";
  let sentHash: string | null=null, sentToken: string | null=null, progress=0, warnings=0, reducedMotion=false;
  let modelSize: { width: number; depth: number; height: number } | null=null;
  const defaultAnchor: ManualAnchor={longitude:106.701,latitude:10.775,elevationMeters:0,rotationDegrees:0,scale:1};
  let saved: ManualAnchor={...defaultAnchor}, draft: ManualAnchor={...defaultAnchor};
  const channel="testifc-bim-gis-v1";
  $: vi=locale==="vi";
  $: valid=[draft.longitude,draft.latitude,draft.elevationMeters,draft.rotationDegrees,draft.scale,draft.groundOffsetMeters??0].every(Number.isFinite)
    && Math.abs(draft.longitude)<=180 && Math.abs(draft.latitude)<=85 && draft.scale>0 && draft.scale<=1000
    && (draft.groundOffsetMeters??0)>=0 && (!modelSize || (draft.groundOffsetMeters??0)<=modelSize.height+.001);
  const dimension=(value: number)=>value.toLocaleString(vi?"vi-VN":"en-US",{maximumFractionDigits:2});
  function send(type: string,data: Record<string,unknown>={}) {frame?.contentWindow?.postMessage({channel,type,...data},location.origin);}
  // Keep the map mounted between documents. The runtime cancels its previous worker.
  $: if(ready && modelHash!==sentHash) void initializeDocument();
  $: if(ready && token!==sentToken) {sentToken=token;send("token",{token});}
  $: if(ready && visible) send("resize");
  $: if(ready && editing && valid) send("anchor",{anchor:draft});
  async function initializeDocument() {
    const hash=modelHash;sentHash=hash;saving=false;loaded=false;modelSize=null;error="";editing=false;mode="none";warnings=0;progress=0;
    saved={...defaultAnchor};draft={...saved};busy=Boolean(hash&&file);status=busy?(vi?"Đang chuẩn bị mô hình…":"Preparing model…"):"";
    send("mode",{mode:"none"});
    if(hash) {
      try {const response=await onRead(hash);if(hash!==modelHash)return;if(response.anchor)saved={...response.anchor};}
      catch {error=vi?"Chưa đọc được vị trí đã lưu. Bạn vẫn có thể đặt mô hình.":"Saved placement unavailable. You can still place the model.";}
    }
    if(hash!==modelHash || !ready)return;
    draft={...saved};send("anchor",{anchor:draft});send("document",{hash,file});
  }
  function begin(next: Mode) {editing=true;error="";mode=mode===next?"none":next;send("mode",{mode});}
  function reset() {draft={...saved};editing=false;mode="none";error="";send("mode",{mode});send("anchor",{anchor:draft});}
  async function save() {
    if(!valid || saving)return;
    const hash=modelHash,anchor={...draft};saving=true;error="";
    try {
      const response=await onSave(hash,anchor);if(hash!==modelHash)return;if(!response.anchor)throw new Error("Missing saved placement");
      saved={...response.anchor};draft={...saved};editing=false;mode="none";send("mode",{mode});send("anchor",{anchor:draft});
      status=vi?"Đã lưu vị trí thủ công":"Manual placement saved";
    } catch {if(hash===modelHash)error=vi?"Không lưu được vị trí. Kiểm tra kết nối bridge rồi thử lại.":"Cannot save placement. Check the bridge and retry.";}
    finally {if(hash===modelHash)saving=false;}
  }
  onMount(()=>{
    const appearance=()=>{
      const style=getComputedStyle(frame.parentElement!), colors: Record<string,string>={};
      for(const name of ["surface-elevated","text-primary","text-secondary","border-default","accent-primary","font-sans"])colors[name]=style.getPropertyValue(`--${name}`).trim();
      reducedMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;send("appearance",{colors,reducedMotion});
    };
    const receive=(event: MessageEvent)=>{
      if(event.source!==frame?.contentWindow || event.origin!==location.origin || event.data?.channel!==channel)return;
      const data=event.data;
      if(data.type==="ready") {ready=true;appearance();}
      if(data.type==="map-ready")mapError="";
      if(data.type==="map-error")mapError=data.message;
      if(data.hash && data.hash!==modelHash)return;
      if((data.type==="picked" || data.type==="surface-picked") && editing) {
        draft={...data.anchor};
        if(data.type==="surface-picked"){mode="none";status=vi?"Đã căn mặt được chọn với nền đường":"Selected surface aligned to road level";}
      }
      if(data.type==="pick-missed")error=vi?"Bấm vào một mặt của mô hình để chọn mốc nền.":"Click a model surface to choose the ground datum.";
      if(data.type==="progress") {
        progress=data.stage==="packing"?.95:Math.min(.9,Math.max(0,data.progress)*.9);
        status=data.stage==="packing"?(vi?"Đang chuẩn bị hiển thị…":"Preparing display…"):(vi?"Đang đọc hình học IFC…":"Reading IFC geometry…");
      }
      if(data.type==="model-ready") {
        loaded=true;busy=false;progress=1;warnings=data.warnings??0;
        const size=data.bounds;
        modelSize=size && [size.width,size.depth,size.height].every((value: unknown)=>typeof value==="number" && Number.isFinite(value))?{...size}:null;
        if(saved.groundOffsetMeters===undefined) {saved={...saved,groundOffsetMeters:data.defaultGroundOffsetMeters??0};draft={...saved};send("anchor",{anchor:draft});}
        status=vi?`IFC sẵn sàng${data.cached?" · cache":""}`:`IFC ready${data.cached?" · cached":""}`;
      }
      if(data.type==="model-error"){busy=false;error=data.message;}
      if(data.type==="cache-warning")error=data.message;
    };
    window.addEventListener("message",receive);
    const resize=new ResizeObserver(()=>{if(visible)send("resize");});resize.observe(frame.parentElement!);
    const theme=new MutationObserver(appearance),shell=frame.closest(".qn-theme");if(shell)theme.observe(shell,{attributes:true,attributeFilter:["data-mode"]});
    const media=matchMedia("(prefers-reduced-motion: reduce)");media.addEventListener("change",appearance);
    return ()=>{window.removeEventListener("message",receive);resize.disconnect();theme.disconnect();media.removeEventListener("change",appearance);};
  });
</script>
<section class="mapbox-workspace" class:hidden={!visible} aria-label="BIM–GIS Mapbox" aria-hidden={!visible} inert={!visible}>
  <iframe bind:this={frame} src="/vendor/bim-gis/index.html" title="Mapbox BIM–GIS"></iframe>
  <div class="map-controls" aria-busy={busy}>
    <header><span class="title"><Icon name="map" size={18}/><strong>BIM–GIS</strong></span><button class="icon-button" title={vi?"Về IFC viewer":"IFC viewer"} aria-label={vi?"Về IFC viewer":"IFC viewer"} onclick={onViewer}><Icon name="close" size={16}/></button></header>
    <p class="filename" title={filename}>{filename || (vi?"Chưa có mô hình":"No model open")}</p>
    {#if !token}<p class="hint">{vi?"Thêm public token để mở bản đồ.":"Add a public token to open the map."}</p><button class="wide" onclick={onSettings}><Icon name="settings" size={15}/>{vi?"Mở Cài đặt Mapbox":"Mapbox settings"}</button>{/if}
    {#if modelSize}
      <div class="dimensions" aria-label={vi?"Kích thước trên bản đồ":"Map dimensions"}>
        <span><small>{vi?"Ngang":"Width"}</small><b>{dimension(modelSize.width*draft.scale)} <em>m</em></b></span>
        <span><small>{vi?"Dài":"Length"}</small><b>{dimension(modelSize.depth*draft.scale)} <em>m</em></b></span>
        <span><small>{vi?"Cao":"Height"}</small><b>{dimension(modelSize.height*draft.scale)} <em>m</em></b></span>
      </div>
    {/if}
    <button class="wide place-button" class:active={mode==="place"} disabled={!token||!loaded||saving} aria-pressed={mode==="place"} onclick={()=>begin("place")}><Icon name="pointer" size={17}/>{vi?"Đặt marker trên bản đồ":"Place marker on map"}</button>
    <div class="tools">
      <button class:active={mode==="align"} disabled={!token||!loaded||saving} aria-pressed={mode==="align"} onclick={()=>begin("align")}><Icon name="ground" size={19}/><span>{vi?"Căn mặt với đường":"Align to road"}</span></button>
      <button class:active={mode==="rotate"} disabled={!token||!loaded||saving} aria-pressed={mode==="rotate"} onclick={()=>begin("rotate")}><Icon name="rotate" size={19}/><span>{vi?"Xoay tại chỗ":"Rotate in place"}</span></button>
      <button disabled={!loaded||saving||!editing} title={vi?"Khôi phục vị trí và mốc nền đã lưu":"Restore saved placement and ground datum"} onclick={reset}><Icon name="reset" size={19}/><span>Reset</span></button>
    </div>
    {#if editing}
      <div class="editing" transition:slide={{duration:reducedMotion?0:280,easing:cubicOut}}>
        <p class="hint">{mode==="place"?(vi?"Bấm lên bản đồ hoặc kéo marker để đặt mô hình.":"Click the map or drag the marker to place the model."):mode==="align"?(vi?"Bấm mặt sàn hoặc mặt móng muốn ngang nền đường.":"Click the slab or foundation surface to align with the road."):mode==="rotate"?(vi?"Kéo ngang trên bản đồ để xoay IFC quanh marker.":"Drag horizontally on the map to rotate IFC around its marker."):(vi?"Xem trước thay đổi, rồi lưu vị trí.":"Review the placement, then save.")}</p>
        {#if mode==="rotate"}<label>{vi?"Góc xoay (°)":"Rotation (°)"}<input type="range" min="0" max="359" step="1" bind:value={draft.rotationDegrees}/><input aria-label={vi?"Xoay IFC (°)":"IFC yaw (°)"} type="number" step="1" bind:value={draft.rotationDegrees}/></label>{/if}
        {#if mode==="align"}<label>{vi?"Mốc nền từ đáy mô hình (m)":"Ground datum above model bottom (m)"}<input type="number" min="0" max={modelSize?.height} step="0.1" bind:value={draft.groundOffsetMeters}/></label>{/if}
        <details><summary>{vi?"Tọa độ và thông số":"Coordinates and settings"}</summary><div class="fields">
          <label>{vi?"Kinh độ":"Longitude"}<input type="number" step="any" bind:value={draft.longitude}/></label>
          <label>{vi?"Vĩ độ":"Latitude"}<input type="number" step="any" bind:value={draft.latitude}/></label>
          <label>{vi?"Cao độ đường (m)":"Road elevation (m)"}<input type="number" step="any" bind:value={draft.elevationMeters}/></label>
          <label>{vi?"Tỷ lệ":"Scale"}<input type="number" min="0.001" max="1000" step="0.1" bind:value={draft.scale}/></label>
        </div></details>
        <div class="edit-actions"><button class="primary" disabled={!valid||saving} onclick={save}>{saving?"…":vi?"Lưu vị trí":"Save placement"}</button><button disabled={saving} onclick={reset}>{vi?"Hủy":"Cancel"}</button></div>
      </div>
    {/if}
    <div class="navigation"><button disabled={!token||!loaded} onclick={()=>send("fly")}><Icon name="fit" size={15}/>{vi?"Tới mô hình":"Fly to model"}</button><button disabled={!token} onclick={()=>send("globe")}><Icon name="globe" size={15}/>{vi?"Địa cầu":"Globe"}</button></div>
    <div class="options"><label><input type="checkbox" bind:checked={markerVisible} onchange={()=>send("marker",{visible:markerVisible})}/>Marker</label><label><input type="checkbox" bind:checked={showUnderground} onchange={()=>send("underground",{visible:showUnderground})}/>{vi?"Phần ngầm":"Underground"}</label><span>×{dimension(draft.scale)}</span></div>
    <div class="quality" aria-label={vi?"Chất lượng GIS":"GIS quality"}><span>{vi?"Hiển thị":"Display"}</span><button class:active={!fullDetails} aria-pressed={!fullDetails} onclick={()=>{fullDetails=false;send("details",{visible:false});}}>{vi?"Mượt":"Smooth"}</button><button class:active={fullDetails} aria-pressed={fullDetails} onclick={()=>{fullDetails=true;send("details",{visible:true});}}>{vi?"Chi tiết":"Detailed"}</button></div>
    <div class="state"><span class="state-dot" class:pending={busy}></span><p class="status" role="status">{status || (vi?"Mở IFC để đặt trên bản đồ":"Open IFC to place on the map")}</p></div>
    {#if busy}<progress max="1" value={progress} aria-label={vi?"Tiến độ BIM–GIS":"BIM–GIS progress"}></progress>{/if}
    {#if warnings}<p class="hint warning">{vi?`Bộ đọc IFC báo ${warnings} cảnh báo hình học; cần đối chiếu các cấu kiện liên quan.`:`IFC reader reported ${warnings} geometry warnings; check the affected elements.`}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{#if !busy&&!loaded}<button class="wide" onclick={()=>void initializeDocument()}>{vi?"Thử lại IFC":"Retry IFC"}</button>{/if}{/if}
    {#if mapError}<p class="error" role="alert">{mapError}</p><button onclick={onSettings}>{vi?"Kiểm tra key":"Check key"}</button>{/if}
    <p class="footnote">{vi?"Vị trí thủ công · chọn mặt làm mốc nền":"Manual placement · surface as ground datum"}</p>
  </div>
</section>
<svelte:window onkeydown={event=>{if(event.key==="Escape"&&visible&&editing&&!saving){event.preventDefault();reset();}}}/>
<style>
  .mapbox-workspace{position:absolute;inset:var(--workspace-top,34px) 0 32px;z-index:2;background:var(--surface-base);opacity:1;visibility:visible;transition:opacity 340ms var(--easing-standard),visibility 0s}
  .hidden{opacity:0;visibility:hidden;pointer-events:none;transition:opacity 340ms var(--easing-standard),visibility 0s 340ms}
  iframe{width:100%;height:100%;border:0}
  .map-controls{position:absolute;left:16px;top:16px;width:304px;max-height:calc(100% - 56px);overflow:auto;padding:14px;box-sizing:border-box;border-radius:var(--radius-md);background:color-mix(in oklch,var(--surface-elevated) 94%,transparent);color:var(--text-primary);border:1px solid var(--border-default);box-shadow:0 12px 32px #0003;backdrop-filter:blur(12px);font:12px/1.4 var(--font-sans);transition:background-color 320ms,color 320ms,border-color 320ms}
  header,.title{display:flex;align-items:center;gap:8px}header{justify-content:space-between}.title{font-size:13px}.title :global(svg){color:var(--accent-primary)}
  p{margin:0}.filename{margin:12px 0;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  button{display:flex;align-items:center;justify-content:center;gap:7px;min-height:32px;padding:6px 9px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--surface-overlay);color:var(--text-secondary);font:inherit;cursor:pointer;transition:color 200ms,background-color 200ms,border-color 200ms}
  button:hover:not(:disabled),button.active{color:var(--text-primary);border-color:var(--accent-primary);background:color-mix(in oklch,var(--accent-primary) 10%,var(--surface-elevated))}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--accent-primary);outline-offset:2px}button:disabled{opacity:.4;cursor:default}.icon-button{min-height:26px;width:26px;padding:4px;border-color:transparent;background:transparent}.wide{width:100%}
  .dimensions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 0 12px;border-top:1px solid var(--border-subtle);font-variant-numeric:tabular-nums}.dimensions span{display:grid;gap:3px}.dimensions small{color:var(--text-muted);font-size:11px}.dimensions b{font-weight:600}.dimensions em{font-size:10px;font-weight:400;font-style:normal;color:var(--text-muted)}
  .place-button{justify-content:flex-start;color:var(--text-primary)}.tools{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}.tools button{flex-direction:column;gap:6px;min-height:68px;padding:8px 4px;font-size:11px}.tools span{max-width:76px;text-align:center}
  .editing{padding:10px 0;border-bottom:1px solid var(--border-subtle)}.hint{color:var(--text-secondary);line-height:1.5;margin-bottom:10px}.editing label{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:11px;margin:10px 0}.editing input[type=range]{width:100%;accent-color:var(--accent-primary)}
  input[type=number]{min-width:0;box-sizing:border-box;padding:6px 8px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--surface-sunken);color:var(--text-primary);font:inherit;width:100%}details{margin:10px 0}summary{color:var(--text-muted);cursor:pointer;padding:4px 0}.fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fields label{margin:2px 0;display:grid}.edit-actions{display:flex;gap:8px}.edit-actions button{flex:1}.primary{color:var(--text-primary);border-color:var(--accent-primary);background:color-mix(in oklch,var(--accent-primary) 14%,var(--surface-elevated))}
  .navigation{display:flex;gap:8px;margin-top:12px}.navigation button{flex:1;font-size:11px}.options{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border-subtle);color:var(--text-secondary);font-size:11px}.options label{display:flex;align-items:center;gap:5px}.options input{margin:0;accent-color:var(--accent-primary)}.options span{margin-left:auto}
  .state{display:flex;align-items:center;gap:7px;min-height:34px}.state-dot{width:5px;height:5px;border-radius:50%;background:var(--accent-primary);flex:none}.pending{opacity:.6}.status{font-size:11px;color:var(--text-secondary)}progress{display:block;width:100%;height:3px;border:0;border-radius:2px;overflow:hidden;accent-color:var(--accent-primary);margin-bottom:10px}progress::-webkit-progress-bar{background:var(--surface-sunken)}progress::-webkit-progress-value{background:var(--accent-primary);transition:width 200ms ease}.error{color:var(--state-warning);margin:8px 0;line-height:1.5}.warning{font-size:11px}.footnote{font-size:10px;color:var(--text-muted)}
  .quality{display:flex;align-items:center;gap:4px;padding-top:10px;font-size:11px;color:var(--text-muted)}.quality span{margin-right:auto}.quality button{min-height:26px;padding:3px 10px;font-size:11px}
  @media(max-width:700px){.map-controls{left:8px;top:8px;width:260px;padding:10px}}
  @media(prefers-reduced-motion:reduce){.mapbox-workspace,.hidden,button,.map-controls{transition:none}}
</style>
