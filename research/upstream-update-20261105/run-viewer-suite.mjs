import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pnpm = 'F:/Steel/VBA/IFC-Lite-Core104/desktop/node_modules/pnpm/bin/pnpm.cjs';
const results = [];
async function run(shard) {
  const output = createWriteStream(resolve(import.meta.dirname, `viewer-shard-${shard}.log`));
  const child = spawn(process.execPath, [pnpm, 'test', '--filter=@ifc-lite/viewer', '--concurrency=2', '--env-mode=loose'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, TEST_PATTERN: '.', TEST_SHARD: String(shard), TEST_SHARDS: '16' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  output.end();
  results.push({ shard, code });
  writeFileSync(resolve(import.meta.dirname, 'viewer-suite-progress.json'), JSON.stringify(results, null, 2));
  console.log(`Viewer shard ${shard}: exit ${code}`);
}
// Warm the exact build once before independent test processes share it.
await run(0);
let next = 1;
async function worker() { while (next < 16) await run(next++); }
await Promise.all([worker(), worker()]);
process.exitCode = results.some(row => row.code !== 0) ? 1 : 0;
