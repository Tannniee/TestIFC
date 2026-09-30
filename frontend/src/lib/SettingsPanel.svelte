<script lang="ts">
  import Icon from './Icon.svelte';
  import MapboxSettings from './MapboxSettings.svelte';
  import CacheSettings from './CacheSettings.svelte';
  import type {CopyText,Locale} from './i18n';
  import type {ViewportBackground} from './viewer-contracts';
  import type {CacheInventory} from './api-contracts';
  export let open:boolean;
  export let section:'general'|'navigation'|'map'|'cache'='general';
  export let locale:Locale;
  export let mode:'light'|'dark';
  export let t:CopyText;
  export let token:string;
  export let gridVisible:boolean;
  export let wheelZoomSpeed:number;
  export let rotationSpeed:number;
  export let viewportBackground:ViewportBackground;
  export let busy:boolean;
  export let onClose:()=>void;
  export let onLocale:(locale:Locale)=>void;
  export let onMode:(mode:'light'|'dark')=>void;
  export let onGrid:(visible:boolean)=>void;
  export let onZoom:(value:number)=>void;
  export let onRotation:(value:number)=>void;
  export let onBackground:(value:ViewportBackground)=>void;
  export let onToken:(value:string)=>void;
  export let loadInventory:()=>Promise<CacheInventory>;
  export let clearCache:(scope:'fragments'|'all')=>Promise<CacheInventory & {freedBytes:number;failedFiles:number}>;
  $: vi=locale==='vi';
  $: sections=[{id:'general' as const,label:vi?'Chung':'General'},{id:'navigation' as const,label:vi?'Điều khiển':'Navigation'},
    {id:'map' as const,label:'BIM–GIS'},{id:'cache' as const,label:vi?'Bộ nhớ':'Storage'}];
  function navigateTabs(event:KeyboardEvent,index:number){
    const keys=['ArrowLeft','ArrowRight','Home','End'];
    if(!keys.includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?sections.length-1:(index+(event.key==='ArrowRight'?1:-1)+sections.length)%sections.length;
    section=sections[next].id;
    const tabs=(event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]');
    tabs?.[next].focus();
  }
</script>
<section class="viewer-settings settings-panel" class:settings-open={open} aria-label={vi?'Cài đặt':'Settings'} aria-hidden={!open} inert={!open}>
  <header class="viewer-settings__header"><h2><Icon name="settings" size={17}/>{vi?'Cài đặt':'Settings'}</h2><button aria-label={t.close} onclick={onClose}><Icon name="close" size={16}/></button></header>
  <div class="settings-tabs" role="tablist" aria-label={vi?'Nhóm cài đặt':'Settings sections'}>{#each sections as item,index}<button id={`settings-tab-${item.id}`} role="tab" tabindex={section===item.id?0:-1} aria-selected={section===item.id} aria-controls={`settings-${item.id}`} onkeydown={event=>navigateTabs(event,index)} onclick={()=>section=item.id}>{item.label}</button>{/each}</div>
  <div class="settings-body">
    <div id="settings-general" role="tabpanel" aria-labelledby="settings-tab-general" hidden={section!=='general'}>
      <section class="setting-group"><h3>{vi?'Ngôn ngữ':'Language'}</h3><div class="segmented" role="group" aria-label={vi?'Ngôn ngữ ứng dụng':'Application language'}><button aria-pressed={locale==='vi'} onclick={()=>onLocale('vi')}>Tiếng Việt</button><button aria-pressed={locale==='en'} onclick={()=>onLocale('en')}>English</button></div></section>
      <section class="setting-group"><h3>{vi?'Giao diện':'Appearance'}</h3><div class="segmented" role="group" aria-label={vi?'Chế độ giao diện':'Theme'}><button aria-pressed={mode==='light'} onclick={()=>onMode('light')}><Icon name="sun" size={15}/>{vi?'Sáng':'Light'}</button><button aria-pressed={mode==='dark'} onclick={()=>onMode('dark')}><Icon name="moon" size={15}/>{vi?'Tối':'Dark'}</button></div></section>
      <section class="setting-group"><fieldset class="viewer-settings__backgrounds"><legend>{t.background}</legend><div class="viewer-settings__choices">{#each ['gray','white','oled'] as background}<label class:viewer-settings__choice--active={viewportBackground===background} class="viewer-settings__choice"><input type="radio" name="viewport-background" checked={viewportBackground===background} onchange={()=>onBackground(background as ViewportBackground)}/><span class={`background-swatch background-swatch-${background}`}></span><span>{background==='gray'?t.backgroundGray:background==='white'?t.backgroundWhite:t.backgroundOled}</span></label>{/each}</div></fieldset>
      <label class="viewer-settings__toggle"><input type="checkbox" checked={gridVisible} onchange={event=>onGrid(event.currentTarget.checked)}/><span>{t.showGrid}</span></label></section>
    </div>
    <div id="settings-navigation" role="tabpanel" aria-labelledby="settings-tab-navigation" hidden={section!=='navigation'}>
      <section class="setting-group"><h3>{vi?'Di chuyển trong mô hình':'Model navigation'}</h3>
        <label class="viewer-settings__slider"><span class="viewer-settings__slider-label"><span>{t.wheelZoomSpeed}</span><output>{wheelZoomSpeed.toFixed(2)}×</output></span><input type="range" min="0.25" max="3" step="0.25" value={wheelZoomSpeed} aria-label={t.wheelZoomSpeed} oninput={event=>onZoom(event.currentTarget.valueAsNumber)}/></label>
        <label class="viewer-settings__slider"><span class="viewer-settings__slider-label"><span>{t.rotationSpeed}</span><output>{rotationSpeed.toFixed(2)}×</output></span><input type="range" min="0.25" max="3" step="0.25" value={rotationSpeed} aria-label={t.rotationSpeed} oninput={event=>onRotation(event.currentTarget.valueAsNumber)}/></label>
        <p>{vi?'Áp dụng ngay khi zoom và xoay mô hình.':'Applies immediately when zooming and orbiting.'}</p><button class="quiet" onclick={()=>{onZoom(1);onRotation(.5);}}>{vi?'Khôi phục mặc định':'Restore defaults'}</button>
      </section>
    </div>
    <div id="settings-map" role="tabpanel" aria-labelledby="settings-tab-map" hidden={section!=='map'}><MapboxSettings {token} {locale} onSave={onToken}/></div>
    <div id="settings-cache" role="tabpanel" aria-labelledby="settings-tab-cache" hidden={section!=='cache'}>{#if open&&section==='cache'}<CacheSettings {locale} {busy} {loadInventory} {clearCache}/>{/if}</div>
  </div>
  <footer>{section==='map'?(vi?'Token được lưu khi bấm Lưu key':'Save the token with Save key'):(vi?'Thay đổi được lưu tự động':'Changes are saved automatically')}<span>1.0.5</span></footer>
</section>
<style>
  .settings-panel{z-index:40}.viewer-settings__header,.settings-tabs,footer{flex-shrink:0}.settings-body{min-height:0}
  .settings-panel{width:352px;padding:0;visibility:hidden;opacity:0;transform:translate3d(0,-10px,0);pointer-events:none;transition:transform 300ms cubic-bezier(.22,1,.36,1),opacity 220ms ease,visibility 0s 300ms;overflow:hidden;display:flex;flex-direction:column;background:var(--surface-elevated)}
  .settings-open{visibility:visible;opacity:1;transform:translate3d(0,0,0);pointer-events:auto;transition-delay:0s}
  .viewer-settings__header{margin:0;padding:12px 14px;border-bottom:1px solid var(--border-subtle)}h2{display:flex;align-items:center;gap:8px}
  .settings-tabs{display:flex;padding:8px 10px;gap:4px;border-bottom:1px solid var(--border-subtle)}.settings-tabs button{flex:1;border:0;border-radius:var(--radius-sm);padding:8px 4px;font:11px var(--font-sans);background:transparent;color:var(--text-secondary);cursor:pointer}.settings-tabs button[aria-selected=true]{background:var(--surface-overlay);color:var(--accent-primary)}
  .settings-body{padding:2px 14px 14px;overflow:auto}.setting-group{padding:12px 0;border-bottom:1px solid var(--border-subtle)}.setting-group:last-child{border:0}h3{margin:0 0 10px;font-size:12px;font-weight:600}.segmented{display:flex;gap:6px}.segmented button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px;border:1px solid var(--border-default);border-radius:var(--radius-sm);font:12px var(--font-sans);color:var(--text-secondary);background:var(--surface-overlay);cursor:pointer;transition:color 180ms,border-color 180ms,background-color 180ms}.segmented button[aria-pressed=true]{color:var(--text-primary);border-color:var(--accent-primary);background:color-mix(in oklch,var(--accent-primary) 10%,var(--surface-elevated))}
  p{font-size:11px;line-height:1.5;color:var(--text-secondary);margin:12px 0}.quiet{border:1px solid var(--border-default);border-radius:var(--radius-sm);font:11px var(--font-sans);padding:7px 10px;background:var(--surface-overlay);color:var(--text-secondary);cursor:pointer}footer{display:flex;justify-content:space-between;gap:8px;padding:10px 14px;border-top:1px solid var(--border-subtle);font-size:10px;color:var(--text-muted)}
  button:focus-visible{outline:2px solid var(--accent-primary);outline-offset:2px} @media(max-width:500px){.settings-panel{width:calc(100% - 24px)}}@media(prefers-reduced-motion:reduce){.settings-panel,.segmented button{transition:none}}
</style>
