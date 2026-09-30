// Adapted from Helen Kwok's bim-gis-viewer (Apache-2.0), pinned in README.md.
// This bundle owns its legacy Three / IFC.js versions, never the normal viewer.
import { IfcViewerAPI } from 'web-ifc-viewer';
import { Dexie } from 'dexie';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Camera, Color, DirectionalLight, AmbientLight, Group, Matrix4, Scene, WebGLRenderer } from 'three';

const channel = 'testifc-bim-gis-v1';
const origin = location.origin;
const send = (type, data = {}) => parent.postMessage({ channel, type, ...data }, origin);
const db = new Dexie('TestIFC-BimGis');
db.version(1).stores({ models: 'key,hash' });
const pipelineVersion = 'ifcjs-1.0.209-full-v1';
let map, marker, renderer, token = '', group = null, bounds = null, currentHash = '';
let revision = 0, conversionQueue = Promise.resolve(), markerVisible = true, picking = false;
let anchor = { longitude:106.701, latitude:10.775, elevationMeters:0, rotationDegrees:0, scale:1 };
let cameraState;
try { cameraState = JSON.parse(sessionStorage.getItem('testifc-map-camera') || 'null'); } catch { /* first visit */ }
const camera = new Camera(), scene = new Scene();
scene.add(new AmbientLight(0xffffff, .7));
for (const y of [-70,70]) { const light = new DirectionalLight(0xffffff, .6); light.position.set(0,y,100); scene.add(light); }
const notice = document.getElementById('notice');
const diagnostics = document.documentElement.dataset;
const matrix = () => {
  const p = mapboxgl.MercatorCoordinate.fromLngLat([anchor.longitude,anchor.latitude],anchor.elevationMeters);
  const s = p.meterInMercatorCoordinateUnits() * anchor.scale;
  const centerX = (bounds.min.x + bounds.max.x)/2, centerZ = (bounds.min.z + bounds.max.z)/2;
  return new Matrix4().makeTranslation(p.x,p.y,p.z)
    .multiply(new Matrix4().makeScale(s,-s,s))
    .multiply(new Matrix4().makeRotationX(Math.PI/2))
    .multiply(new Matrix4().makeRotationY(-anchor.rotationDegrees*Math.PI/180))
    .multiply(new Matrix4().makeTranslation(-centerX,-bounds.min.y,-centerZ));
};
const layer = {
  id:'testifc-model',type:'custom',renderingMode:'3d',
  onAdd(m,gl) { renderer = new WebGLRenderer({ canvas:m.getCanvas(),context:gl,antialias:true }); renderer.autoClear=false; diagnostics.modelLayer='ready'; },
  render(gl,projection) {
    if (!group || !bounds) return;
    camera.projectionMatrix.fromArray(projection).multiply(matrix());
    renderer.resetState(); renderer.render(scene,camera); renderer.resetState();
    diagnostics.renderedTriangles=String(renderer.info.render.triangles);
    // Static IFC: repaint on map movement / placement, no endless render loop.
  },
  onRemove() { renderer?.dispose(); renderer=null; diagnostics.modelLayer='none'; },
};
function syncLayer(repaint = true) {
  if (!map?.isStyleLoaded()) return;
  const mercator = map.getProjection().name === 'mercator';
  if ((!group || !mercator) && map.getLayer(layer.id)) map.removeLayer(layer.id);
  if (group && mercator && !map.getLayer(layer.id)) map.addLayer(layer);
  if (repaint) map.triggerRepaint();
}
function syncMarker() {
  if (!map) return;
  marker?.remove(); marker=null;
  if (currentHash && markerVisible) marker=new mapboxgl.Marker({color:'#32aac2'}).setLngLat([anchor.longitude,anchor.latitude]).addTo(map);
  syncLayer();
}
function createMap(nextToken) {
  if (map) { cameraState={center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),projection:map.getProjection().name}; marker?.remove(); map.remove(); map=null; }
  token=nextToken;
  if (!token) { notice.textContent='Nhập public token Mapbox trong Cài đặt để mở bản đồ.'; return; }
  notice.textContent='';
  try {
    map=new mapboxgl.Map({ container:'map',accessToken:token,style:'mapbox://styles/mapbox/light-v10',antialias:true,
      projection:cameraState?.projection || 'globe',center:cameraState?.center || [106.701,10.775],zoom:cameraState?.zoom ?? 1.5,
      pitch:cameraState?.pitch || 0,bearing:cameraState?.bearing || 0 });
    map.addControl(new mapboxgl.NavigationControl({visualizePitch:true}),'bottom-left');
    const geocoder=new MapboxGeocoder({accessToken:token,mapboxgl,marker:false,placeholder:'Tìm địa điểm / Search'});
    map.addControl(geocoder,'top-right');
    geocoder.on('result',({result}) => { map.setProjection('mercator'); syncLayer(); if (picking && result.center) { anchor={...anchor,longitude:result.center[0],latitude:result.center[1]}; syncMarker(); send('picked',{anchor}); } });
    geocoder.on('error',()=>send('map-error',{message:'Không tìm được địa điểm. Kiểm tra key và kết nối.'}));
    map.on('style.load',()=>{
      map.setFog({range:[.8,8],color:'#ffffff','high-color':'#5576ac','space-color':'#07142c','star-intensity':.6});
      if (map.getSource('composite') && !map.getLayer('testifc-buildings')) {
        const label=map.getStyle().layers.find(l=>l.type==='symbol' && l.layout?.['text-field']);
        map.addLayer({id:'testifc-buildings',source:'composite','source-layer':'building',filter:['==','extrude','true'],type:'fill-extrusion',minzoom:15,
          paint:{'fill-extrusion-color':'#aaa','fill-extrusion-height':['interpolate',['linear'],['zoom'],15,0,15.05,['get','height']],
          'fill-extrusion-base':['interpolate',['linear'],['zoom'],15,0,15.05,['get','min_height']],'fill-extrusion-opacity':.6}},label?.id);
      }
      syncMarker(); send('map-ready');
    });
    map.on('error',()=>send('map-error',{message:'Mapbox không tải được dữ liệu. Kiểm tra public key, quyền URL và kết nối mạng.'}));
    // Projection changes briefly mark the style unloaded. Attach the custom
    // layer once that transition finishes, including the first flight.
    map.on('idle',()=>syncLayer(false));
    map.on('zoomend',()=>{ if(map.getZoom()>=6 && map.getProjection().name==='globe') map.setProjection('mercator'); });
    map.on('moveend',()=>{ cameraState={center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),projection:map.getProjection().name}; sessionStorage.setItem('testifc-map-camera',JSON.stringify(cameraState)); });
    map.on('click',e=>{ if (!picking || !currentHash) return; anchor={...anchor,longitude:e.lngLat.lng,latitude:Math.max(-85,Math.min(85,e.lngLat.lat))}; syncMarker(); send('picked',{anchor}); });
  } catch { notice.textContent='Không thể khởi tạo WebGL / Mapbox.'; send('map-error',{message:notice.textContent}); }
}
function disposeGroup(value) {
  if (!value) return;
  scene.remove(value);
  const geometries=new Set(), materials=new Set(), textures=new Set();
  value.traverse(object=>{ if(object.geometry) geometries.add(object.geometry); for(const m of object.material ? (Array.isArray(object.material)?object.material:[object.material]) : []) { materials.add(m); for(const v of Object.values(m)) if(v?.isTexture) textures.add(v); } });
  geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); textures.forEach(t=>t.dispose());
}
async function exportIfc(file,hash,version) {
  const key=`${pipelineVersion}:${hash}`;
  try { const cached=await db.models.get(key); if(cached) return {...cached,cached:true}; } catch { /* conversion also works if storage is unavailable */ }
  let viewer, url;
  try {
    viewer=new IfcViewerAPI({container:document.getElementById('converter'),backgroundColor:new Color(0xffffff)});
    // WebIFC 0.0.35 prefixes this path with the worker's own directory even
    // when given an absolute URL. Keep it relative to IFCWorker.js.
    await viewer.IFC.setWasmPath('./');
    await viewer.IFC.loader.ifcManager.useWebWorkers(true,new URL('IFCWorker.js',location.href).href);
    url=URL.createObjectURL(file);
    // Full mesh export avoids losing categories omitted by the demo's allowlist.
    const result=await viewer.GLTF.exportIfcFileAsGltf({ifcFileUrl:url,getProperties:true,
      onProgress:(loaded,total,stage)=>{ if(version===revision) send('progress',{hash,stage,progress:total?loaded/total:0}); }});
    const models=[]; for(const category of Object.values(result.gltf)) for(const item of Object.values(category)) if(item.file) models.push(await item.file.arrayBuffer());
    const properties=[]; for(const item of result.json) properties.push(await item.arrayBuffer());
    if(!models.length) throw new Error('IFC không có hình học để hiển thị.');
    const entry={key,hash,models,properties};
    if(version===revision) { try { await db.models.put(entry); } catch { send('cache-warning',{message:'Không lưu được cache IndexedDB; mô hình vẫn được hiển thị.'}); } }
    return {...entry,cached:false};
  } catch(error) { console.error('IFC.js export failed:', error?.message || 'unknown'); throw error; }
  finally {
    if(url) URL.revokeObjectURL(url);
    if(viewer) {
      // The exporter only disposes its temporary loader on successful export.
      try { await viewer.GLTF.tempIfcLoader?.ifcManager.dispose(); } catch { /* failed worker already terminated */ }
      await viewer.dispose();
    }
  }
}
async function loadDocument(file,hash,version) {
  let next;
  try {
    const entry=await exportIfc(file,hash,version);
    if(version!==revision) return;
    next=new Group(); const loader=new GLTFLoader();
    for(const data of entry.models) { const gltf=await loader.parseAsync(data,''); next.add(gltf.scene); }
    if(version!==revision) { disposeGroup(next); return; }
    const box=new Box3().setFromObject(next);
    if(box.isEmpty() || ![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite)) throw new Error('Giới hạn hình học IFC không hợp lệ.');
    disposeGroup(group); group=next; bounds=box; scene.add(group); syncMarker();
    let triangles=0; group.traverse(object=>{ if(object.isMesh) triangles+=(object.geometry.index?.count ?? object.geometry.attributes.position.count)/3; });
    diagnostics.modelState='ready'; diagnostics.modelTriangles=String(triangles);
    send('model-ready',{hash,cached:entry.cached,bounds:{width:box.max.x-box.min.x,depth:box.max.z-box.min.z,height:box.max.y-box.min.y},properties:entry.properties.length});
  } catch { disposeGroup(next); if(version===revision) { diagnostics.modelState='error'; send('model-error',{hash,message:'Không chuyển được IFC bằng IFC.js. Viewer IFC hiện tại vẫn dùng được; thử lại hoặc dùng file IFC khác.'}); } }
}
function fly() {
  if(!map) return;
  map.setProjection('mercator'); syncLayer();
  const span=bounds?Math.max(bounds.max.x-bounds.min.x,bounds.max.z-bounds.min.z)*anchor.scale:60;
  const zoom=Math.max(13,Math.min(20.5,Math.log2(40075016.686*Math.cos(anchor.latitude*Math.PI/180)*Math.max(map.getContainer().clientHeight,300)/(512*Math.max(span*3,30)))));
  map.flyTo({center:[anchor.longitude,anchor.latitude],zoom,pitch:65,bearing:-80,duration:1800});
}
window.addEventListener('message',event=>{
  if(event.source!==parent || event.origin!==origin || event.data?.channel!==channel) return;
  const {type}=event.data;
  if(type==='token') { const t=event.data.token; if(typeof t==='string' && (!t || /^pk\.[A-Za-z0-9._-]+$/.test(t)) && t!==token) createMap(t); else if(!t && !map) createMap(''); }
  if(type==='document') {
    const {file,hash}=event.data; const version=++revision; currentHash=typeof hash==='string'?hash:'';
    diagnostics.modelHash=currentHash; diagnostics.modelState=currentHash?'converting':'empty'; diagnostics.modelTriangles='0';
    disposeGroup(group); group=null; bounds=null; syncMarker();
    if(file instanceof File && currentHash) conversionQueue=conversionQueue.catch(()=>{}).then(()=>version===revision?loadDocument(file,currentHash,version):undefined);
  }
  if(type==='anchor') {
    const a=event.data.anchor;
    if(a && [a.longitude,a.latitude,a.elevationMeters,a.rotationDegrees,a.scale].every(Number.isFinite) && Math.abs(a.longitude)<=180 && Math.abs(a.latitude)<=85 && a.scale>0 && a.scale<=1000) {anchor={...a};diagnostics.modelYaw=String(a.rotationDegrees);syncMarker();}
  }
  if(type==='pick') { picking=event.data.enabled===true; if(map) map.getCanvas().style.cursor=picking?'crosshair':''; }
  if(type==='marker') {markerVisible=event.data.visible===true;syncMarker();}
  if(type==='fly') fly();
  if(type==='globe' && map) {map.setProjection('globe');syncLayer();map.flyTo({center:[anchor.longitude,anchor.latitude],zoom:1.5,pitch:0,bearing:0,duration:1800});}
  if(type==='resize') map?.resize();
});
send('ready');
