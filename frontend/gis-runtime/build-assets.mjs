import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
const target = new URL('../public/vendor/bim-gis/', import.meta.url);
await mkdir(target, { recursive: true });
for (const [source, name] of [
  ['index.html', 'index.html'],
  ['UPSTREAM-LICENSE.txt', 'UPSTREAM-LICENSE.txt'],
  ['node_modules/web-ifc-three/IFCWorker.js', 'IFCWorker.js'],
  ['node_modules/web-ifc/web-ifc.wasm', 'web-ifc.wasm'],
  ['node_modules/web-ifc/web-ifc-mt.wasm', 'web-ifc-mt.wasm'],
  ['node_modules/mapbox-gl/dist/mapbox-gl.js', 'mapbox-gl.js'],
  ['node_modules/mapbox-gl/dist/mapbox-gl.css', 'mapbox-gl.css'],
  ['node_modules/@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.min.js', 'geocoder.js'],
  ['node_modules/@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css', 'geocoder.css'],
  ['node_modules/mapbox-gl/LICENSE.txt', 'MAPBOX-LICENSE.txt'],
  ['node_modules/@mapbox/mapbox-gl-geocoder/LICENSE', 'GEOCODER-LICENSE.txt'],
  ['node_modules/three/LICENSE', 'THREE-LICENSE.txt'],
  ['node_modules/dexie/LICENSE', 'DEXIE-LICENSE.txt'],
  ['WEB-IFC-LICENSE.txt', 'WEB-IFC-LICENSE.txt'],
  ['WEB-IFC-THREE-LICENSE.txt', 'WEB-IFC-THREE-LICENSE.txt'],
  ['WEB-IFC-VIEWER-LICENSE.txt', 'WEB-IFC-VIEWER-LICENSE.txt'],
]) await copyFile(new URL(source, import.meta.url), new URL(name, target));

// Upstream dispatches async worker actions without awaiting / reporting rejected
// promises. A failed WASM instantiate must reject the caller instead of hanging.
const workerPath = new URL('IFCWorker.js', target);
const worker = await readFile(workerPath, 'utf8');
const dispatch = 'requestedWorker[action](data);';
if (!worker.includes(dispatch)) throw new Error('Pinned worker dispatch patch no longer matches');
await writeFile(workerPath, worker.replace(dispatch,
  `try { await requestedWorker[action](data); }
   catch (error) { ifcWorker.post({ ...data, error: String(error?.message || 'IFC worker action failed') }); }`));
