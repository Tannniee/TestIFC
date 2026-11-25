// Root Turbo graph, using the viewer's supported shard contract on Windows.
import { spawn } from 'node:child_process';
import { writeFileSync, createWriteStream } from 'node:fs';
import { resolve, delimiter } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const git = 'C:/Users/tanng/AppData/Local/ifclite-build-tools/git/bin';
const results = [];
let next = 0;
async function runShard(shard) {
  const started = Date.now();
  const stream = createWriteStream(resolve(import.meta.dirname, `viewer-shard-${shard}.log`));
  const run = spawn(process.execPath, [resolve(root, 'desktop/node_modules/pnpm/bin/pnpm.cjs'),
    'test', '--filter=@ifc-lite/viewer', '--env-mode=loose'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, PATH: `${resolve(root, 'desktop/node_modules/.bin')}${delimiter}${git}${delimiter}${process.env.PATH ?? ''}`,
      npm_config_script_shell: `${git}/bash.exe`, TEST_SHARDS: '12', TEST_SHARD: String(shard) },
  });
  run.stdout.pipe(stream, { end: false }); run.stderr.pipe(stream, { end: false });
  const exit = await new Promise((yes, no) => { run.on('error', no); run.on('close', yes); });
  await new Promise(yes => stream.end(yes));
  const row = { shard, exit, milliseconds: Date.now() - started };
  results.push(row);
  writeFileSync(resolve(import.meta.dirname, 'viewer-suite.json'), JSON.stringify([...results].sort((a,b) => a.shard-b.shard), null, 2));
  console.log(JSON.stringify(row));
}
async function worker() { while (next < 12) await runShard(next++); }
await Promise.all(Array.from({ length: Number(process.env.AUDIT_TEST_WORKERS || 8) }, worker));
process.exitCode = results.some(r => r.exit !== 0) ? 1 : 0;
