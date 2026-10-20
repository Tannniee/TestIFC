/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { existsSync } from 'node:fs';
import { basename, delimiter, join, resolve } from 'node:path';

/** Launch the installed pnpm without sending arguments through cmd.exe.
 * Windows cannot exec a .cmd shim. A pnpm script supplies its real Node entry
 * in npm_execpath; direct node invocations can use the same installed layouts
 * on PATH. Missing pnpm is an error, never an automatic download.
 * @returns {[string, string[]]}
 */
export function pnpmCommand(args, { env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return ['pnpm', args];
  const entry = env.npm_execpath;
  if (entry && /^pnpm\.(?:cjs|mjs|js)$/i.test(basename(entry))) {
    return [process.execPath, [entry, ...args]];
  }
  for (const raw of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!raw) continue;
    const directory = raw.replace(/^"(.*)"$/, '$1');
    const candidates = [
      join(directory, 'pnpm.cjs'),
      join(directory, 'node_modules/pnpm/bin/pnpm.cjs'),
      resolve(directory, '../pnpm/bin/pnpm.cjs'),
    ];
    const cli = candidates.find(candidate => existsSync(candidate));
    if (cli) return [process.execPath, [cli, ...args]];
    const executable = join(directory, 'pnpm.exe');
    if (existsSync(executable)) return [executable, args];
  }
  throw new Error('Cannot find the installed pnpm Node entry or pnpm.exe. Run through pnpm, or put its installation on PATH.');
}
