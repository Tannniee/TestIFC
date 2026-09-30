import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/render-scheduler.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { RenderScheduler, FragmentUpdates, NavigationPixelRatio } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("camera bursts coalesce but a forced final view wakes a waiting dispatch", async () => {
  const calls = [];
  const updates = new FragmentUpdates(async force => { calls.push(force); }, 1000);
  await updates.request();
  const pending = updates.request();
  updates.request(); updates.request();
  assert.deepEqual(calls, [false]);
  await updates.request(true);
  await pending;
  assert.deepEqual(calls, [false, true]);
  const final = updates.request();
  await updates.dispose();
  await final;
  assert.deepEqual(calls, [false, true]);
});

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

test("navigation resolution responds to sustained slow frames and restores at rest", () => {
  const quality = new NavigationPixelRatio(2);
  assert.equal(quality.begin(false), 2);
  quality.sample(0);
  for (let time = 25; time <= 125; time += 25) quality.sample(time);
  assert.equal(quality.sample(150), 1.75);
  assert.equal(quality.sample(1150), 1.75); // A background-tab pause is not a slow frame.
  assert.equal(quality.end(), 2);
});

test("navigation resolution starts conservatively for dense scenes and recovers only after fast frames", () => {
  const quality = new NavigationPixelRatio(2);
  assert.equal(quality.begin(true), 0.75);
  quality.sample(0);
  for (let time = 10; time <= 190; time += 10) quality.sample(time);
  assert.equal(quality.sample(200), 1);
  assert.equal(quality.end(), 2);
  assert.equal(new NavigationPixelRatio(0.5).begin(true), 0.5);
});
