/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pnpmCommand } from './pnpm-command.mjs';

// Windows lint regression: execute a real Node CLI, including spaces and shell
// metacharacters, rather than asserting on a command string or a source file.
function withCli(run) {
  const root = mkdtempSync(join(tmpdir(), 'pnpm literal & space-'));
  const entry = join(root, 'pnpm.cjs');
  writeFileSync(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exitCode = process.argv.includes("--refuse") ? 17 : 0;');
  try { run(root, entry); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('Windows pnpm launch preserves code and path arguments without a shell', () => withCli((_root, entry) => {
  const args = ['-e', 'console.log(process.cwd())', 'a b', 'x&y', '%PATH%', 'a"b', '$(echo literal)'];
  const result = spawnSync(...pnpmCommand(args, { platform: 'win32', env: { npm_execpath: entry } }), { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
}));

test('Windows pnpm child refusal remains a nonzero result with its complete output', () => withCli((_root, entry) => {
  const result = spawnSync(...pnpmCommand(['--refuse'], { platform: 'win32', env: { npm_execpath: entry } }), { encoding: 'utf8' });
  assert.equal(result.status, 17);
  assert.deepEqual(JSON.parse(result.stdout), ['--refuse']);
}));

test('direct Windows node invocation finds the installed Node CLI beside a bin directory', () => withCli((root) => {
  const bin = join(root, '.bin');
  mkdirSync(bin);
  const installed = join(root, 'pnpm', 'bin');
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, 'pnpm.cjs'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const result = spawnSync(...pnpmCommand(['--version'], { platform: 'win32', env: { PATH: bin, npm_execpath: join(root, 'npm-cli.js') } }), { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['--version']);
}));

test('missing Windows pnpm fails before a gate can report success', () => {
  assert.throws(() => pnpmCommand([], { platform: 'win32', env: { PATH: '' } }), /Cannot find the installed pnpm/);
});

test('a Corepack bootstrap alone cannot start a gate or trigger a pnpm download', () => withCli(root => {
  const bootstrap = join(root, 'bootstrap');
  const dist = join(bootstrap, 'node_modules', 'corepack', 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'pnpm.js'), 'throw new Error("bootstrap must not run");');
  assert.throws(() => pnpmCommand(['exec', 'oxlint'], { platform: 'win32', env: { PATH: bootstrap } }), /Cannot find the installed pnpm/);
}));
