#!/usr/bin/env node
// Headless Emulsion export driver: forces frame production via CDP screencast
// (headless Chrome idles rAF otherwise), clicks ⏺ Export, waits for the upload.
// Usage: node export.mjs <shot-name-label> <seconds> [framesDir]
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9232;
const URL_ = process.env.EMULSION_URL || 'http://localhost:8741';
const [, , label = 'export', secs = '6', framesDir] = process.argv;

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const proc = execFile(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/emulsion-export-profile', '--window-size=1440,900',
  '--enable-unsafe-swiftshader', '--no-first-run', 'about:blank',
], () => {});
await new Promise((r) => setTimeout(r, 2500));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
let frameNo = 0;
if (framesDir) mkdirSync(framesDir, { recursive: true });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Page.screencastFrame') {
    if (framesDir) writeFileSync(`${framesDir}/f${String(frameNo++).padStart(5, '0')}.jpg`,
      Buffer.from(m.params.data, 'base64'));
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck',
      params: { sessionId: m.params.sessionId } }));
  }
};
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_ });
await new Promise((r) => setTimeout(r, 4000));
// keep the frame pipeline hot for the whole recording
await send('Page.startScreencast', { format: 'jpeg', quality: 55, everyNthFrame: 1 });

const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
await evalJs(`document.getElementById('shotName').value = ${JSON.stringify(label)};
  document.getElementById('recBtn').click(); 'started'`);

const waitMs = (+secs) * 1000 + 9000;
const res = await evalJs(`new Promise(r => setTimeout(() => r(JSON.stringify({
  badge: document.getElementById('recbadge').style.display,
  toast: document.getElementById('toast').textContent,
  time: document.getElementById('timeLabel').textContent })), ${waitMs}))`);
console.log('RESULT:', res.result?.result?.value);
console.log('frames:', frameNo);

await send('Page.stopScreencast');
ws.close();
proc.kill();
