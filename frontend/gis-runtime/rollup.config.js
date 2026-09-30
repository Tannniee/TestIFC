import { nodeResolve } from '@rollup/plugin-node-resolve';
export default [
  { input: 'runtime.js', output: { file: '../public/vendor/bim-gis/runtime.js', format: 'esm' }, plugins: [nodeResolve()] },
  { input: 'modern-convert.worker.js', output: { file: '../public/vendor/bim-gis/modern-convert.worker.js', format: 'esm' }, plugins: [nodeResolve()] },
];
