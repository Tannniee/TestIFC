/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

describe('@ifc-lite/wasm packaging', () => {
  it('packs the core wasm files into the published tarball', () => {
    const packDir = mkdtempSync(join(tmpdir(), 'ifc-lite-wasm-pack-'));

    try {
      const pnpmCli = process.env.npm_execpath;
      assert.ok(pnpmCli, 'Run packaging checks through the root pnpm test command');
      // The Windows .cmd launcher is not an executable for execFileSync.
      execFileSync(process.execPath, [pnpmCli, 'pack', '--pack-destination', packDir], {
        cwd: packageDir,
        stdio: 'pipe',
      });

      const [tarball] = readdirSync(packDir).filter((name) => name.endsWith('.tgz'));
      assert.ok(tarball, 'expected pnpm pack to produce a tarball');

      // A drive-letter path is a remote archive to GNU tar; use its local cwd.
      const listing = execFileSync('tar', ['-tf', tarball], {
        cwd: packDir,
        encoding: 'utf8',
      });

      assert.match(listing, /package\/pkg\/ifc-lite\.js/);
      assert.match(listing, /package\/pkg\/ifc-lite\.d\.ts/);
      assert.match(listing, /package\/pkg\/ifc-lite_bg\.wasm/);
    } finally {
      rmSync(packDir, { recursive: true, force: true });
    }
  });
});
