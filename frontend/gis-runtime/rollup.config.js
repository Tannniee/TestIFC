import { nodeResolve } from '@rollup/plugin-node-resolve';
export default {
  input: 'runtime.js',
  output: { file: '../public/vendor/bim-gis/runtime.js', format: 'esm' },
  plugins: [nodeResolve(), {
    name: 'legacy-ifc-worker-errors',
    transform(code, id) {
      const path = id.replaceAll('\\', '/');
      if (path.endsWith('/web-ifc-viewer/dist/components/ifc/ifc-properties.js')) {
        const patched = code.replace('const siteReference = building.ObjectPlacement.PlacementRelTo;',
          'if (!building?.ObjectPlacement) return 0; const siteReference = building.ObjectPlacement.PlacementRelTo;')
          .replace('const transform = placement.Coordinates.map((coord) => coord.value);',
            'if (!placement?.Coordinates) return 0; const transform = placement.Coordinates.map((coord) => coord.value);');
        if (patched === code) throw new Error('Pinned IFC property placement patch no longer matches');
        return { code: patched, map: null };
      }
      if (!path.endsWith('/web-ifc-three/IFCLoader.js')) return null;
      // Upstream otherwise leaves all promises pending after a WASM/worker
      // failure. Reject them and later cleanup requests instead of hanging.
      const patched = code.replace(
        'this.ifcWorker.onmessage = (data) => this.handleResponse(data);',
        `this.ifcWorker.onmessage = (event) => {
          if (!event.data.error) { this.handleResponse(event); return; }
          this.workerFailure = new Error(event.data.error);
          Object.values(this.rejectHandlers).forEach(reject => reject(this.workerFailure));
          this.ifcWorker.terminate();
        };
        this.ifcWorker.onerror = () => {
          this.workerFailure = new Error('IFC.js worker failed to load or parse WASM/IFC');
          Object.values(this.rejectHandlers).forEach(reject => reject(this.workerFailure));
          this.ifcWorker.terminate();
        };`,
      ).replace('request(worker, action, args) {',
        'request(worker, action, args) { if (this.workerFailure) return Promise.reject(this.workerFailure);');
      if (patched === code) throw new Error('Pinned IFC worker patch no longer matches');
      return { code: patched, map: null };
    },
  }],
};
