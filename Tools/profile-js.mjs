#!/usr/bin/env node
// Records a CPU profile of the game's JavaScript inside Unreal through the V8 inspector.
//   node Tools/profile-js.mjs --port 9229 --seconds 30 --out unlit.cpuprofile [--wait 20]
// Start Unreal with run-unreal.mjs --inspect 9229. The profile opens in Chrome DevTools (Performance tab).
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const port = +flag('--port', 9229), seconds = +flag('--seconds', 30), wait = +flag('--wait', 0);
const out = flag('--out', 'unreal.cpuprofile');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let target;
for (const end = Date.now() + 600000; Date.now() < end; await sleep(1000)) {
  target = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).then(l => l[0]).catch(() => null);
  if (target) break;
}
if (!target) throw Error(`no V8 inspector on port ${port}`);
const ws = new WebSocket(target.webSocketDebuggerUrl ?? `ws://127.0.0.1:${port}`);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({id: n, method, params})); });
if (wait) { console.log(`waiting ${wait} s before profiling`); await sleep(wait * 1000); }
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', {interval: 500});
await send('Profiler.start');
console.log(`profiling for ${seconds} s`);
await sleep(seconds * 1000);
const {result} = await send('Profiler.stop');
fs.writeFileSync(out, JSON.stringify(result.profile));
console.log(`wrote ${out} (${result.profile.samples.length} samples)`);
ws.close();
