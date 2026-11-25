import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const out = import.meta.dirname;
const exes = { base: join(out, 'base-perf-probe.exe'), branch: process.env.BRANCH_PERF_EXE || join(out, 'branch-final-perf-probe.exe') };
const report = { started: new Date().toISOString(), scope: 'Native canonical worker-pool parse and geometry; excludes browser/GPU/UI',
  environment: 'Agent-controlled builds/tests/browser evidence sessions closed; unrelated user apps remain open', hashes: {}, fixtures: [] };
for (const [key, path] of Object.entries(exes)) report.hashes[key] = createHash('sha256').update(await readFile(path)).digest('hex');
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const fixture of ['tests/models/ara3d/AC20-FZK-Haus.ifc',
  'tests/models/ara3d/ISSUE_129_N1540_17_EXE_MOD_448200_02_09_11SMC_IGC_V17.ifc']) {
  const runs = [];
  // Reverse the order of each successive pair; a new process per observation.
  for (let i = 0; i < 5; i++) for (const variant of i % 2 ? ['branch', 'base'] : ['base', 'branch']) {
    const result = spawnSync(exes[variant], [fixture, '--iters', '1', '--json', '--fingerprint'],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const [row] = JSON.parse(result.stdout);
    runs.push({ iteration: i + 1, variant, ...row });
  }
  const summary = {};
  for (const variant of ['base', 'branch']) {
    const rows = runs.filter(r => r.variant === variant);
    summary[variant] = Object.fromEntries(['parseMs', 'geometryMs', 'totalMs'].map(k => [k, median(rows.map(r => r[k]))]));
    summary[variant].wallMs = median(rows.map(r => r.allWallMs[0]));
  }
  summary.deltaPercent = Object.fromEntries(['parseMs', 'geometryMs', 'totalMs', 'wallMs'].map(k =>
    [k, (summary.branch[k] - summary.base[k]) / summary.base[k] * 100]));
  const payloads = {};
  for (const variant of ['base', 'branch']) {
    const rows = runs.filter(r => r.variant === variant);
    for (const k of ['meshes', 'vertices', 'triangles', 'csgFailures']) assert.ok(rows.every(r => r[k] === rows[0][k]), k);
    const fingerprints = new Set(rows.flatMap(r => r.meshFingerprintsFnv1a64));
    assert.equal(fingerprints.size, 1, 'each variant must emit stable ordered geometry');
    payloads[variant] = { fingerprint: [...fingerprints][0], ...Object.fromEntries(
      ['meshes', 'vertices', 'triangles', 'csgFailures'].map(k => [k, rows[0][k]])) };
  }
  const byteIdentical = payloads.base.fingerprint === payloads.branch.fingerprint;
  if (fixture.includes('AC20-FZK')) assert.ok(byteIdentical, 'house control must remain identical');
  const identity = { byteIdentical, payloads, verdict: byteIdentical ? 'unchanged geometry' :
    'intentional all-through topology repair; independent ISSUE_129 host oracle evidence under issue129-packaged-base/ and common-plane-issue129-comparison.json' };
  report.fixtures.push({ fixture, summary, identity, runs });
  console.log(JSON.stringify({ fixture, summary, identity }));
}
report.finished = new Date().toISOString();
await writeFile(process.env.PERF_OUT || join(out, 'perf-interleaved-final.json'), JSON.stringify(report, null, 2));
