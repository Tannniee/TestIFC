<script lang="ts">
  import {onDestroy} from 'svelte';
  import type {ModelDataService} from './model-data-service';
  import type {SemanticCondition,SemanticFieldCatalog} from './api-contracts';
  export let service:ModelDataService;
  export let owner:string;
  export let open:boolean;
  export let modelReady:boolean;
  export let ifcType:string;
  export let locale:'vi'|'en';
  export let reset=0;
  export let eligibleIds:Set<number>|null=null;
  export let onResults:(ids:Set<number>|null)=>void;
  export let onSelect:(ids:number[])=>Promise<void>;
  export let onAction:(action:'isolate'|'showAll',ids:number[])=>Promise<void>;
  type Row=SemanticCondition & {id:number};
  const row=(id:number):Row=>({id,kind:'pset',setName:'',propertyName:'',op:'eq',value:''});
  let conditions:Row[]=[row(0)],nextId=1,match:'all'|'any'='all';
  let previousOwner='',previousReset=reset,revision=0,catalogRevision=0,catalogOwner='',fields:SemanticFieldCatalog['fields']=[];
  let loading=false,acting=false,error='',message='',loaded=0,total=0,runningKey='',appliedKey='';
  let result:{total:number;selectableIds:number[]}|null=null;
  $: vi=locale==='vi';
  $: queryKey=JSON.stringify([conditions.map(({id,...condition})=>condition),match,ifcType]);
  $: valid=conditions.every(item=>item.setName.trim()&&item.propertyName.trim()&&(!['gt','gte','lt','lte'].includes(item.op)||item.value.trim()!==''&&Number.isFinite(Number(item.value.replace(',','.')))));
  $: if(owner!==previousOwner||reset!==previousReset){previousOwner=owner;previousReset=reset;conditions=[row(nextId++)];fields=[];catalogOwner='';catalogRevision++;invalidate();}
  $: if(open&&modelReady&&catalogOwner!==owner){catalogOwner=owner;void loadFields();}
  $: if((runningKey&&runningKey!==queryKey)||(appliedKey&&appliedKey!==queryKey))invalidate();
  $: actionIds=result?.selectableIds.filter(id=>eligibleIds===null||eligibleIds.has(id))??[];
  function invalidate(){revision++;loading=false;acting=false;error='';message='';result=null;loaded=total=0;runningKey=appliedKey='';onResults(null);}
  async function loadFields(){
    const version=++catalogRevision,expected=owner;
    try{const catalog=await service.getSemanticFields();if(version===catalogRevision&&owner===expected)fields=catalog.fields;}
    catch{if(version===catalogRevision&&owner===expected)fields=[];}
  }
  function sets(kind:string){return [...new Set(fields.filter(field=>field.kind===kind).map(field=>field.setName))];}
  function properties(item:Row){return [...new Set(fields.filter(field=>field.kind===item.kind&&field.setName.toLocaleLowerCase()===item.setName.toLocaleLowerCase()).map(field=>field.propertyName))];}
  function unit(item:Row){return fields.find(field=>field.kind===item.kind&&field.setName.toLocaleLowerCase()===item.setName.toLocaleLowerCase()&&field.propertyName.toLocaleLowerCase()===item.propertyName.toLocaleLowerCase())?.unit;}
  async function apply(event:SubmitEvent){
    event.preventDefault();if(!valid||!modelReady||acting)return;
    const version=++revision,key=queryKey;runningKey=key;appliedKey='';loading=true;error='';message='';result=null;onResults(null);
    const query={conditions:conditions.map(({id,...item})=>({...item,setName:item.setName.trim(),propertyName:item.propertyName.trim(),value:item.kind==='qto'||['gt','gte','lt','lte'].includes(item.op)?item.value.replace(/^(-?\d+),(\d+)$/,'$1.$2'):item.value})),match,ifcType};
    try{
      const response=await service.searchAllSemantic(query,(count,found)=>{if(version===revision){loaded=count;total=found;}},()=>version!==revision);
      if(version!==revision)return;
      if(response.coldStatus!=='ready'){message=vi?'INDEX chưa sẵn sàng. Thử lại khi lập chỉ mục hoàn tất.':'INDEX is not ready. Retry after indexing finishes.';return;}
      result={total:response.total,selectableIds:response.selectableIds};appliedKey=key;
      onResults(new Set(response.results.map(item=>item.localId)));
    }catch(failure){if(version===revision)error=vi?'Không hoàn tất bộ lọc BIM. Hãy kiểm tra dữ liệu và thử lại.':'Could not complete the BIM filter. Check the values and retry.';}
    finally{if(version===revision){loading=false;runningKey='';}}
  }
  async function act(action:'select'|'isolate'|'showAll'){
    if(loading||acting||!modelReady||(action!=='showAll'&&!actionIds.length))return;
    const version=revision;acting=true;error='';
    try{if(action==='select')await onSelect(actionIds);else await onAction(action,action==='showAll'?[]:actionIds);}
    catch{if(version===revision)error=vi?'Chưa áp dụng được nhóm cấu kiện. Thử lại.':'Could not apply the element group. Retry.';}
    finally{if(version===revision)acting=false;}
  }
  onDestroy(()=>{revision++;catalogRevision++;});
</script>
<section class="bim-filter" aria-label={vi?'Lọc dữ liệu BIM':'BIM data filter'}>
  <details open>
    <summary>{vi?'Lọc dữ liệu BIM':'BIM data filter'}<span>{conditions.length}/8</span></summary>
    <form onsubmit={apply}>
      <fieldset disabled={!modelReady||acting}>
        {#if conditions.length>1}<label class="match-label">{vi?'Kết hợp điều kiện':'Match conditions'}<select aria-label={vi?'Kết hợp điều kiện':'Match conditions'} bind:value={match}><option value="all">{vi?'Tất cả (AND)':'All (AND)'}</option><option value="any">{vi?'Bất kỳ (OR)':'Any (OR)'}</option></select></label>{/if}
        <div class="condition-list">{#each conditions as item,i (item.id)}<div class="condition" data-condition={i}>
          <div class="condition-heading"><small>{vi?'Điều kiện':'Condition'} {i+1}</small>{#if conditions.length>1}<button type="button" aria-label={`${vi?'Xóa điều kiện':'Remove condition'} ${i+1}`} onclick={()=>conditions=conditions.filter(c=>c.id!==item.id)}>×</button>{/if}</div>
          <div class="condition-options"><select aria-label={`Property kind${i?' '+(i+1):''}`} bind:value={item.kind}><option value="pset">Pset</option><option value="qto">Qto</option></select><select aria-label={`Property operator${i?' '+(i+1):''}`} bind:value={item.op}><option value="eq">=</option><option value="contains">{vi?'chứa':'contains'}</option><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option></select></div>
          <input aria-label={`Set name${i?' '+(i+1):''}`} placeholder={vi?'Tên Pset / Qto':'Pset / Qto name'} list={`bim-sets-${item.id}`} bind:value={item.setName}/><datalist id={`bim-sets-${item.id}`}>{#each sets(item.kind) as name}<option value={name}></option>{/each}</datalist>
          <input aria-label={`Property name${i?' '+(i+1):''}`} placeholder={vi?'Tên thuộc tính':'Property name'} list={`bim-properties-${item.id}`} bind:value={item.propertyName}/><datalist id={`bim-properties-${item.id}`}>{#each properties(item) as name}<option value={name}></option>{/each}</datalist>
          <input aria-label={`Property value${i?' '+(i+1):''}`} placeholder={vi?'Giá trị cần lọc':'Filter value'} bind:value={item.value}/>
          {#if item.kind==='qto'}<small class="unit">{vi?'Đơn vị SI':'SI units'}{unit(item)?`: ${unit(item)}`:' (m, m², m³, kg)'}</small>{/if}
        </div>{/each}</div>
        <div class="filter-options"><button type="button" disabled={conditions.length>=8} onclick={()=>conditions=[...conditions,row(nextId++)]}>+ {vi?'Điều kiện':'Condition'}</button><button type="button" onclick={()=>void loadFields()} title={vi?'Lấy danh sách trường từ IFC đang xem':'Read fields from the active IFC'}>{vi?'Nạp trường':'Load fields'}</button></div>
        <div class="filter-buttons"><button type="submit" class="apply" disabled={!valid||loading}>{loading?'…':vi?'Áp dụng':'Apply'}</button><button type="button" onclick={()=>{conditions=[row(nextId++)];match='all';invalidate();}}>{vi?'Xóa lọc':'Clear'}</button></div>
      </fieldset>
    </form>
  </details>
  {#if loading}<p role="status">{vi?'Đang lọc':'Filtering'} {loaded} / {total||'…'}</p>{/if}
  {#if message}<p role="status">{message}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if result}<div class="filter-results"><p role="status">{result.total} {vi?'kết quả':'results'} · {actionIds.length} {vi?'có thể chọn':'selectable'}</p><div class="filter-buttons"><button disabled={!modelReady||acting||!actionIds.length} onclick={()=>void act('select')}>{vi?'Chọn kết quả':'Select results'}</button><button disabled={!modelReady||acting||!actionIds.length} onclick={()=>void act('isolate')}>{vi?'Cô lập':'Isolate'}</button></div><button class="restore" disabled={!modelReady||acting} onclick={()=>void act('showAll')}>{vi?'Hiện tất cả':'Show all'}</button></div>{/if}
</section>
<style>
  .bim-filter{flex:0 1 auto;max-height:55%;min-height:0;overflow:auto;box-sizing:border-box}
  summary::before{content:'▾';margin-right:6px;color:var(--text-muted)}details:not([open]) summary::before{content:'▸'}
  .bim-filter{padding:10px;border-bottom:1px solid var(--border-subtle);font:11px/1.4 var(--font-sans)}summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-weight:600;padding:2px 0 6px}summary span{font-size:10px;color:var(--text-muted);font-weight:400}fieldset{border:0;margin:0;padding:0;min-width:0}.condition-list{max-height:32vh;overflow:auto;display:grid;gap:8px}.condition{display:grid;gap:5px;padding:7px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm)}.condition-heading{display:flex;align-items:center;justify-content:space-between;color:var(--text-secondary)}.condition-heading button{padding:0 5px;min-height:18px;border:0;background:transparent}.condition-options{display:grid;grid-template-columns:1fr 90px;gap:6px}input,select{box-sizing:border-box;min-width:0;width:100%;padding:6px 7px;background:var(--surface-sunken);color:var(--text-primary);border:1px solid var(--border-default);border-radius:var(--radius-sm);font:inherit}.filter-options,.filter-buttons{display:flex;gap:6px;margin-top:7px}.filter-options button{padding:3px 5px;background:transparent;border-color:transparent;color:var(--text-secondary)}button{padding:6px 8px;min-height:28px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--surface-overlay);color:var(--text-primary);font:inherit;cursor:pointer;transition:border-color 180ms,background-color 180ms}button:hover{border-color:var(--accent-primary)}button:disabled{opacity:.45;cursor:default}.filter-buttons button{flex:1}.apply{border-color:var(--accent-primary)}p{margin:8px 0 4px;padding:0!important;color:var(--text-secondary)}.error{color:var(--state-warning)}.unit{color:var(--text-muted);font-size:10px}.match-label{display:grid;gap:5px;margin-bottom:8px}.filter-results{border-top:1px solid var(--border-subtle);margin-top:9px;padding-top:2px}.restore{width:100%;margin-top:6px}input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent-primary);outline-offset:2px}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
