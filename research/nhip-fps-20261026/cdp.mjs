import { readFile } from 'node:fs/promises';
export const dir = process.env.SVD_REPORT_DIR || 'desktop/reports/svd-fps-20261015';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function connect(url) {
  const ws = new WebSocket(url);
  let next = 0;
  const pending = new Map(), listeners = new Set();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message); pending.delete(message.id);
    } else for (const fn of listeners) fn(message);
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const send = (method, params = {}, timeout = 120000) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, timeout);
    pending.set(id, message => {
      clearTimeout(timer);
      message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, listeners, close: () => ws.close(), evaluate: async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  } };
}
export async function attach() {
  const session = JSON.parse(await readFile(`${dir}/session.json`, 'utf8'));
  const targets = await (await fetch(`http://127.0.0.1:${session.port}/json`)).json();
  const client = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  return { ...client, session };
}
