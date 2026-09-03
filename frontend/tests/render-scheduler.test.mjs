import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/render-scheduler.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { RenderScheduler, FragmentUpdates } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("render sleeps at rest, coalesces changes, continues animation and cancels disposal", () => {
  const queue = new Map(); let next = 0; let moving = false; let draws = 0;
  const scheduler = new RenderScheduler(() => { draws++; return moving; }, cb => { queue.set(++next, cb); return next; }, id => queue.delete(id));
  const frame = () => { const [id, callback] = queue.entries().next().value; queue.delete(id); callback(10); };
  scheduler.invalidate(); scheduler.invalidate();
  assert.equal(queue.size, 1); frame();
  assert.equal(queue.size, 0); assert.equal(draws, 1);
  moving = true; scheduler.invalidate(); frame();
  assert.equal(queue.size, 1);
  moving = false; frame(); assert.equal(queue.size, 0);
  scheduler.invalidate(); scheduler.dispose(); assert.equal(queue.size, 0);
  scheduler.invalidate(); assert.equal(queue.size, 0);
});

test("fragment requests stay serial and preserve a forced update behind a busy worker", async () => {
  const calls = []; let release;
  const updates = new FragmentUpdates(async force => { calls.push(force); if (calls.length === 1) await new Promise(resolve => { release = resolve; }); });
  const first = updates.request(false);
  const final = updates.request(true);
  updates.request(false);
  assert.deepEqual(calls, [false]); release(); await Promise.all([first, final]);
  assert.deepEqual(calls, [false, true]);
  await updates.dispose(); await updates.request(true);
  assert.deepEqual(calls, [false, true]);
});

test("an update requested as the previous drain resolves is not lost", async () => {
  let count = 0;
  const updates = new FragmentUpdates(async () => {
    count++;
    if (count === 1) queueMicrotask(() => queueMicrotask(() => updates.request(true)));
  });
  await updates.request(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(count, 2);
  await updates.dispose();
});
