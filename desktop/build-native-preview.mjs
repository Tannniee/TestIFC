/* This Source Code Form is subject to the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [join(desktop, 'run-tauri.mjs'), 'build', '--no-bundle'], {
  cwd: desktop, env: { ...process.env, VITE_IFCLITE_NATIVE: '1' }, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
