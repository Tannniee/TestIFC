// Mapbox context is isolated from the normal viewer; IFC conversion uses its WebIFC 0.0.78.
import { Dexie } from 'dexie';
import { GltfInstancing } from './gltf-instancing.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Camera, DirectionalLight, AmbientLight, Matrix4, Plane, Raycaster, Scene, Vector3, WebGLRenderer } from 'three';

const channel = 'testifc-bim-gis-v1', origin = location.origin;
const send = (type, data = {}) => parent.postMessage({ channel, type, ...data }, origin);
const db = new Dexie('TestIFC-BimGis'); db.version(1).stores({ models: 'key,hash' });
const pipelineVersion = 'webifc-0.0.78-gpu-instances-v4';
let map, marker, renderer, token = '', group = null, bounds = null, currentHash = '';
let fullDetails=false;
let revision = 0, activeWorker, rejectConversion, mode = 'none', markerVisible = true, underground = false;
let pendingFlight=false, defaultGround = 0, visibleRevision = -1, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let anchor = { longitude:106.701, latitude:10.775, elevationMeters:0, rotationDegrees:0, scale:1 };
let cameraState;
try { cameraState = JSON.parse(sessionStorage.getItem('testifc-map-camera') || 'null'); } catch {}
const camera = new Camera(), scene = new Scene(), placement = new Matrix4();
const groundPlane = new Plane(new Vector3(0,1,0),0);
scene.add(new AmbientLight(0xffffff, .65));
for (const y of [-70,70]) { const light = new DirectionalLight(0xffffff,.45); light.position.set(0,y,100); scene.add(light); }
const notice = document.getElementById('notice'), diagnostics = document.documentElement.dataset;
const ground = () => bounds ? bounds.min.y + (anchor.groundOffsetMeters ?? defaultGround) : 0;
function updatePlacement() {
  if (bounds) {
    const p = mapboxgl.MercatorCoordinate.fromLngLat([anchor.longitude,anchor.latitude],anchor.elevationMeters);
    const s = p.meterInMercatorCoordinateUnits() * anchor.scale;
    placement.makeTranslation(p.x,p.y,p.z).multiply(new Matrix4().makeScale(s,-s,s))
      .multiply(new Matrix4().makeRotationX(Math.PI/2)).multiply(new Matrix4().makeRotationY(-anchor.rotationDegrees*Math.PI/180))
      .multiply(new Matrix4().makeTranslation(-(bounds.min.x+bounds.max.x)/2,-ground(),-(bounds.min.z+bounds.max.z)/2));
    groundPlane.constant = -ground();
  }
  diagnostics.modelYaw = String(anchor.rotationDegrees); diagnostics.groundOffset = String(anchor.groundOffsetMeters ?? defaultGround);
  diagnostics.anchorLongitude = String(anchor.longitude); diagnostics.anchorLatitude = String(anchor.latitude);
  map?.triggerRepaint();
}
const layer = {
  id:'testifc-model', type:'custom', renderingMode:'3d',
  onAdd(m,gl) { renderer = new WebGLRenderer({canvas:m.getCanvas(),context:gl,antialias:true}); renderer.autoClear=false; diagnostics.modelLayer='ready'; },
  render(gl,projection) {
    if (!group || !bounds) return;
    camera.projectionMatrix.fromArray(projection).multiply(placement);
    updateDetailVisibility();
    renderer.clippingPlanes = underground ? [] : [groundPlane];
    renderer.resetState(); renderer.render(scene,camera); renderer.resetState();
    diagnostics.renderedTriangles=String(renderer.info.render.triangles);
    diagnostics.drawCalls=String(renderer.info.render.calls);
    if (renderer.info.render.triangles > 0 && visibleRevision !== revision) { visibleRevision=revision; send('model-visible',{hash:currentHash}); }
  },
  onRemove() { renderer?.dispose(); renderer=null; diagnostics.modelLayer='none'; },
};
function updateDetailVisibility() {
  const m=camera.projectionMatrix.elements,canvas=map.getCanvas();
  let minW=Infinity,maxX=0,maxY=0;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
    minW=Math.min(minW,m[3]*x+m[7]*y+m[11]*z+m[15]);
    maxX=Math.max(maxX,Math.abs(m[0]*x+m[4]*y+m[8]*z+m[12]));
    maxY=Math.max(maxY,Math.abs(m[1]*x+m[5]*y+m[9]*z+m[13]));
  }
  // Conservative perspective bound over the whole model. Only features whose
  // projected bounding sphere is very small are deferred; their cached
  // geometry is retained and they become visible again when zooming closer.
  const nw=Math.hypot(m[3],m[7],m[11]);
  const rate=minW>0?Math.max((Math.hypot(m[0],m[4],m[8])+maxX/minW*nw)*canvas.clientWidth,(Math.hypot(m[1],m[5],m[9])+maxY/minW*nw)*canvas.clientHeight)/(2*minW):Infinity;
  const threshold=map.isMoving()?3:1.5;
  let deferred=0;
  group.traverse(object=>{
    if(!object.isMesh)return;
    const hysteresis=object.visible ? .85 : 1.15;
    object.visible=fullDetails||(object.userData.gisDetailRadius??Infinity)*rate>=threshold*hysteresis;
    if(!object.visible)deferred+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*(object.count??1);
  });
  diagnostics.deferredTriangles=String(deferred);
}
function syncLayer(repaint=true) {
  if (!map?.isStyleLoaded()) return;
  const mercator = map.getProjection().name==='mercator';
  if ((!group || !mercator) && map.getLayer(layer.id)) map.removeLayer(layer.id);
  if (group && mercator && !map.getLayer(layer.id)) map.addLayer(layer);
  if (repaint) map.triggerRepaint();
}
function syncMarker() {
  if (!map) {updatePlacement();return;}
  if (currentHash && markerVisible) {
    if (!marker) {
      marker=new mapboxgl.Marker({color:'#32aac2'}).setLngLat([anchor.longitude,anchor.latitude]).addTo(map);
      marker.on('dragend',()=>{const p=marker.getLngLat();anchor={...anchor,longitude:p.lng,latitude:p.lat};updatePlacement();send('picked',{anchor});});
    } else marker.setLngLat([anchor.longitude,anchor.latitude]);
    marker.setDraggable(mode==='place');
  } else { marker?.remove(); marker=null; }
  updatePlacement(); syncLayer();
}
function setMode(next) {
  mode=next; diagnostics.interaction=mode;
  if(map) { map.getCanvas().style.cursor=mode==='align'||mode==='place'?'crosshair':mode==='rotate'?'ew-resize':'';
    if(mode==='rotate') {map.dragPan.disable();map.dragRotate.disable();} else {map.dragPan.enable();map.dragRotate.enable();} }
  marker?.setDraggable(mode==='place');
}
function pickSurface(pixel) {
  if (!group || !renderer) return;
  const canvas=map.getCanvas(), x=pixel.x/canvas.clientWidth*2-1, y=1-pixel.y/canvas.clientHeight*2;
  const inverse=camera.projectionMatrix.clone().invert(), near=new Vector3(x,y,-1).applyMatrix4(inverse), far=new Vector3(x,y,1).applyMatrix4(inverse);
  const ray=new Raycaster();ray.set(near,far.sub(near).normalize());group.updateMatrixWorld(true);
  const visibleMeshes=[];group.traverse(object=>{if(object.isMesh&&object.visible)visibleMeshes.push(object);});
  const hit=ray.intersectObjects(visibleMeshes,false).find(hit=>underground||hit.point.y>=ground()-0.001);
  if (!hit) {send('pick-missed');return;}
  anchor={...anchor,groundOffsetMeters:Math.max(0,hit.point.y-bounds.min.y)};
  updatePlacement();setMode('none');send('surface-picked',{anchor});
}
function createMap(nextToken) {
  if(map) {cameraState={center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),projection:map.getProjection().name};marker?.remove();marker=null;map.remove();map=null;}
  token=nextToken;
  if(!token) {notice.textContent='Thêm public token Mapbox trong Cài đặt để mở bản đồ.';return;}
  notice.textContent='';
  try {
    map=new mapboxgl.Map({container:'map',accessToken:token,style:'mapbox://styles/mapbox/light-v10',antialias:true,
      projection:cameraState?.projection||'globe',center:cameraState?.center||[106.701,10.775],zoom:cameraState?.zoom??1.5,
      pitch:cameraState?.pitch||0,bearing:cameraState?.bearing||0,fadeDuration:400});
    map.addControl(new mapboxgl.NavigationControl({visualizePitch:true}),'bottom-left');
    map.addControl(new mapboxgl.ScaleControl({unit:'metric'}),'bottom-right');
    const geocoder=new MapboxGeocoder({accessToken:token,mapboxgl,marker:false,placeholder:'Tìm địa điểm / Search'});
    map.addControl(geocoder,'top-right');
    geocoder.on('result',({result})=>{map.setProjection('mercator');syncLayer();if(mode==='place'&&result.center){anchor={...anchor,longitude:result.center[0],latitude:result.center[1]};syncMarker();send('picked',{anchor});}});
    geocoder.on('error',()=>send('map-error',{message:'Không tìm được địa điểm. Kiểm tra key và kết nối.'}));
    map.on('style.load',()=>{
      map.setFog({range:[.8,8],color:'#ffffff','high-color':'#5576ac','space-color':'#07142c','star-intensity':.6});
      if(map.getSource('composite')&&!map.getLayer('testifc-buildings')) {
        const label=map.getStyle().layers.find(l=>l.type==='symbol'&&l.layout?.['text-field']);
        map.addLayer({id:'testifc-buildings',source:'composite','source-layer':'building',filter:['==','extrude','true'],type:'fill-extrusion',minzoom:15,
          paint:{'fill-extrusion-color':'#aaa','fill-extrusion-height':['interpolate',['linear'],['zoom'],15,0,15.05,['get','height']],
          'fill-extrusion-base':['interpolate',['linear'],['zoom'],15,0,15.05,['get','min_height']],'fill-extrusion-opacity':.6}},label?.id);
      }
      syncMarker();setMode(mode);send('map-ready');if(pendingFlight)fly();
    });
    map.on('error',()=>send('map-error',{message:'Mapbox không tải được dữ liệu. Kiểm tra key và kết nối mạng.'}));
    map.on('idle',()=>syncLayer(false));
    map.on('moveend',()=>{cameraState={center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),projection:map.getProjection().name};sessionStorage.setItem('testifc-map-camera',JSON.stringify(cameraState));map.triggerRepaint();});
    map.on('click',e=>{
      if(!currentHash)return;
      if(mode==='align')pickSurface(e.point);
      if(mode==='place') {anchor={...anchor,longitude:e.lngLat.lng,latitude:Math.max(-85,Math.min(85,e.lngLat.lat))};syncMarker();send('picked',{anchor});}
    });
    let drag;
    const canvas=map.getCanvas();
    canvas.addEventListener('pointerdown',event=>{if(mode==='rotate'&&event.button===0){drag={x:event.clientX,yaw:anchor.rotationDegrees};canvas.setPointerCapture(event.pointerId);}});
    canvas.addEventListener('pointermove',event=>{if(!drag||mode!=='rotate')return;anchor={...anchor,rotationDegrees:((drag.yaw+(event.clientX-drag.x)*.35)%360+360)%360};updatePlacement();send('picked',{anchor});});
    canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
  } catch {notice.textContent='Không thể khởi tạo WebGL / Mapbox.';send('map-error',{message:notice.textContent});}
}
function disposeGroup(value) {
  if(!value)return;scene.remove(value);
  const geometries=new Set(),materials=new Set();
  value.traverse(object=>{if(object.isInstancedMesh)object.dispose();if(object.geometry)geometries.add(object.geometry);for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[])materials.add(material);});
  geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());
}
async function exportIfc(file,hash,version) {
  const key=`${pipelineVersion}:${hash}`;
  try {const cached=await db.models.get(key);if(cached)return {...cached,cached:true};}catch {}
  const bytes=await file.arrayBuffer();if(version!==revision)throw new Error('Conversion cancelled');
  const result=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('modern-convert.worker.js',location.href),{type:'module'});activeWorker=worker;rejectConversion=reject;
    worker.onmessage=({data})=>{
      if(data.type==='progress') {if(version===revision)send('progress',{hash,stage:data.stage,progress:data.progress});return;}
      worker.terminate();if(activeWorker===worker){activeWorker=null;rejectConversion=null;}
      if(data.type==='done')resolve(data);else reject(new Error(data.message));
    };
    worker.onerror=()=>{worker.terminate();if(activeWorker===worker){activeWorker=null;rejectConversion=null;}reject(new Error('Không tải hoặc chuyển được IFC trong worker.'));};
    worker.postMessage({bytes},[bytes]);
  });
  const entry={key,hash,models:result.models,properties:result.properties,metadata:result.metadata};
  if(version===revision)try {await db.models.put(entry);}catch {send('cache-warning',{message:'Không lưu được cache; mô hình vẫn được hiển thị.'});}
  return {...entry,cached:false};
}
async function loadDocument(file,hash,version) {
  let next;
  try {
    const entry=await exportIfc(file,hash,version);if(version!==revision)return;
    const loader=new GLTFLoader();loader.register(parser=>new GltfInstancing(parser));next=(await loader.parseAsync(entry.models[0],'')).scene;
    if(version!==revision){disposeGroup(next);return;}
    const span=entry.metadata?.span;
    const box=span?new Box3(new Vector3(-span[0]/2,0,-span[2]/2),new Vector3(span[0]/2,span[1],span[2]/2)):new Box3().setFromObject(next), size=box.getSize(new Vector3());
    if(box.isEmpty()||![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite)||Math.max(size.x,size.y,size.z)<=1e-6)throw new Error('Hình học IFC rỗng hoặc có kích thước bằng 0.');
    let triangles=0;next.traverse(object=>{if(object.isMesh)triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*(object.isInstancedMesh?object.count:1);});
    if(!triangles)throw new Error('IFC không có tam giác để hiển thị.');
    disposeGroup(group);group=next;bounds=box;defaultGround=entry.metadata?.groundOffsetMeters??0;scene.add(group);syncMarker();
    diagnostics.modelState='ready';diagnostics.modelTriangles=String(triangles);diagnostics.geometryWarnings=String(entry.metadata?.warnings??0);
    send('model-ready',{hash,cached:entry.cached,bounds:{width:size.x,depth:size.z,height:size.y},defaultGroundOffsetMeters:defaultGround,warnings:entry.metadata?.warnings??0,properties:entry.properties.length});
    fly();
  }catch(error){disposeGroup(next);if(version===revision){diagnostics.modelState='error';console.error('GIS conversion failed:',error?.message);send('model-error',{hash,message:error?.message||'Không chuyển được IFC.'});}}
}
function fly() {
  if(!map||!map.isStyleLoaded()){pendingFlight=Boolean(group);return;}pendingFlight=false;
  if(map.getProjection().name!=='mercator')map.setProjection('mercator');syncLayer();
  const size=bounds?.getSize(new Vector3());
  const visibleHeight=size?(underground?size.y:Math.max(0,size.y-(ground()-bounds.min.y))):0;
  const span=size?Math.max(size.x,size.z,visibleHeight*1.2)*anchor.scale:60;
  const viewport=Math.max(300,Math.min(map.getContainer().clientHeight,map.getContainer().clientWidth-360));
  const zoom=Math.max(9,Math.min(20.5,Math.log2(40075016.686*Math.cos(anchor.latitude*Math.PI/180)*viewport/(512*Math.max(span*1.7,30)))));
  map.flyTo({center:[anchor.longitude,anchor.latitude],zoom,offset:[0,Math.min(.2,.24*visibleHeight*anchor.scale/span)*map.getContainer().clientHeight],pitch:55,bearing:map.getBearing()||-45,duration:reducedMotion?0:1800});
}
window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==origin||event.data?.channel!==channel)return;
  const data=event.data;
  if(data.type==='token') {const t=data.token;if(typeof t==='string'&&(!t||/^pk\.[A-Za-z0-9._-]+$/.test(t))&&t!==token)createMap(t);}
  if(data.type==='document') {
    const version=++revision;activeWorker?.terminate();activeWorker=null;rejectConversion?.(new Error('Conversion cancelled'));rejectConversion=null;
    currentHash=typeof data.hash==='string'?data.hash:'';diagnostics.modelHash=currentHash;diagnostics.modelState=currentHash?'converting':'empty';diagnostics.modelTriangles='0';diagnostics.renderedTriangles='0';
    disposeGroup(group);group=null;bounds=null;defaultGround=0;setMode('none');syncMarker();
    if(data.file instanceof File&&currentHash)void loadDocument(data.file,currentHash,version);
  }
  if(data.type==='anchor') {
    const a=data.anchor;
    if(a&&[a.longitude,a.latitude,a.elevationMeters,a.rotationDegrees,a.scale,a.groundOffsetMeters??0].every(Number.isFinite)&&Math.abs(a.longitude)<=180&&Math.abs(a.latitude)<=85&&a.scale>0&&a.scale<=1000&&(a.groundOffsetMeters??0)>=0) {anchor={...a};syncMarker();}
  }
  if(data.type==='mode'&&['none','place','align','rotate'].includes(data.mode))setMode(data.mode);
  if(data.type==='pick')setMode(data.enabled?'place':'none');
  if(data.type==='underground'){underground=data.visible===true;map?.triggerRepaint();}
  if(data.type==='details'){fullDetails=data.visible===true;map?.triggerRepaint();}
  if(data.type==='marker'){markerVisible=data.visible===true;syncMarker();}
  if(data.type==='fly')fly();
  if(data.type==='globe'&&map){map.setProjection('globe');syncLayer();map.flyTo({center:[anchor.longitude,anchor.latitude],zoom:1.5,pitch:0,bearing:0,duration:reducedMotion?0:1800});}
  if(data.type==='resize')map?.resize();
  if(data.type==='appearance') {reducedMotion=data.reducedMotion===true;for(const [key,value]of Object.entries(data.colors||{}))if(typeof value==='string')document.documentElement.style.setProperty(`--${key}`,value);}
});
send('ready');
