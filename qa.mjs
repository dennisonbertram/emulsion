#!/usr/bin/env node
// Minimal headless QA probe for Emulsion: node qa.mjs [js-expression] [screenshot.png]
// Launches its own headless Chrome, loads the app, prints eval result + page errors.
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9231;
const URL_ = process.env.EMULSION_URL || 'http://localhost:8741';

import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const proc = execFile(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/emulsion-qa-profile', '--window-size=1280,800',
  '--no-first-run', 'about:blank',
], () => {});
await new Promise((r) => setTimeout(r, 2500));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description || JSON.stringify(m.params.exceptionDetails));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push(m.params.entry.text);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.navigate', { url: URL_ });
await new Promise((r) => setTimeout(r, 5000));

const expr = process.argv[2] || 'document.title';
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
console.log('EVAL:', JSON.stringify(res.result?.result?.value ?? res.result));
console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'none');

if (process.argv[3]) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(process.argv[3], Buffer.from(shot.result.data, 'base64'));
  console.log('SHOT:', process.argv[3]);
}
// no process.exit() — it truncates unflushed stdout on large outputs
ws.close();
proc.kill();
