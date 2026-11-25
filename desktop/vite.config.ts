/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { defineConfig, mergeConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import upstream from '../apps/viewer/vite.config.ts';

const desktop = dirname(fileURLToPath(import.meta.url));
export default defineConfig(async (env) => mergeConfig(
  typeof upstream === 'function' ? await upstream(env) : await upstream, {
  root: resolve(desktop, '../apps/viewer'),
  build: { outDir: resolve(desktop, 'dist'), emptyOutDir: true },
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(desktop, 'package.json'), 'utf8')).version) },
  plugins: [{ name: 'desktop-native-entry', transformIndexHtml: {
    order: 'pre', handler: () => [{ tag: 'script', attrs: {
      type: 'module', src: `/@fs/${resolve(desktop, 'native-bootstrap.ts').replaceAll('\\', '/')}`,
    }, injectTo: 'head-prepend' }],
  } }],
  resolve: {
    alias: [
      { find: /^@ifc-lite\/geometry$/, replacement: resolve(desktop, 'wasm-geometry.ts') },
      { find: /^@vercel\/analytics\/react$/, replacement: resolve(desktop, 'local-analytics.ts') },
    ],
  },
}));
