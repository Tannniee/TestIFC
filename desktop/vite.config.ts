/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { defineConfig, mergeConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import upstream from '../apps/viewer/vite.config.ts';

const desktop = dirname(fileURLToPath(import.meta.url));
export default defineConfig(mergeConfig(upstream, {
  root: resolve(desktop, '../apps/viewer'),
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
