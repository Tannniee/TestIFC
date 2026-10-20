/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = dirname(fileURLToPath(import.meta.url));
const root = resolve(desktop, '..');
const portableGit = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ifclite-build-tools/git/bin');
const env = {
  ...process.env,
  PATH: [join(desktop, 'node_modules/.bin'), ...(portableGit && existsSync(portableGit) ? [portableGit] : []), process.env.PATH ?? ''].join(delimiter),
  TURBO_TELEMETRY_DISABLED: '1',
};

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The upstream Windows escape hatch fetches the matching published WASM version.
if (!existsSync(join(root, 'packages/wasm/pkg/ifc-lite_bg.wasm'))) {
  run([join(root, 'scripts/fetch-prebuilt-wasm.mjs')]);
}
run([join(desktop, 'node_modules/pnpm/bin/pnpm.cjs'), 'exec', 'turbo', 'build', '--filter=@ifc-lite/viewer^...']);
const dev = process.argv.includes('--dev');
run([
  join(root, 'apps/viewer/node_modules/vite/bin/vite.js'),
  ...(dev ? ['--host', '127.0.0.1', '--port', '3000', '--strictPort'] : ['build']),
  '--config', join(desktop, 'vite.config.ts'),
], join(root, 'apps/viewer'));
if (!dev) run([join(root, 'scripts/check-tla-chunk-await.mjs')]);
