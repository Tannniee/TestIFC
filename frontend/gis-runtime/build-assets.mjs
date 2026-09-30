import { copyFile, mkdir, rm } from 'node:fs/promises';
const target = new URL('../public/vendor/bim-gis/', import.meta.url);
await mkdir(target, { recursive: true });
const modern = new URL('modern/', target);
await mkdir(modern, { recursive: true });
await copyFile(new URL('../node_modules/web-ifc/web-ifc.wasm', import.meta.url), new URL('web-ifc.wasm', modern));
await copyFile(new URL('../node_modules/web-ifc/LICENSE.md', import.meta.url), new URL('WEB-IFC-0.0.78-LICENSE.md', target));
for (const [source, name] of [
  ['index.html', 'index.html'],
  ['UPSTREAM-LICENSE.txt', 'UPSTREAM-LICENSE.txt'],
  ['node_modules/mapbox-gl/dist/mapbox-gl.js', 'mapbox-gl.js'],
  ['node_modules/mapbox-gl/dist/mapbox-gl.css', 'mapbox-gl.css'],
  ['node_modules/@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.min.js', 'geocoder.js'],
  ['node_modules/@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css', 'geocoder.css'],
  ['node_modules/mapbox-gl/LICENSE.txt', 'MAPBOX-LICENSE.txt'],
  ['node_modules/@mapbox/mapbox-gl-geocoder/LICENSE', 'GEOCODER-LICENSE.txt'],
  ['node_modules/three/LICENSE', 'THREE-LICENSE.txt'],
  ['node_modules/dexie/LICENSE', 'DEXIE-LICENSE.txt'],
]) await copyFile(new URL(source, import.meta.url), new URL(name, target));

// Remove only obsolete generated assets in this runtime's own output directory.
for (const name of ['IFCWorker.js', 'web-ifc.wasm', 'web-ifc-mt.wasm', 'WEB-IFC-LICENSE.txt', 'WEB-IFC-THREE-LICENSE.txt', 'WEB-IFC-VIEWER-LICENSE.txt']) await rm(new URL(name, target), { force: true });
