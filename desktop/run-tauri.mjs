/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [
  join(desktop, 'node_modules/@tauri-apps/cli/tauri.js'), ...process.argv.slice(2),
], {
  cwd: desktop,
  env: { ...process.env, PATH: `${join(homedir(), '.cargo/bin')}${delimiter}${process.env.PATH ?? ''}` },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
