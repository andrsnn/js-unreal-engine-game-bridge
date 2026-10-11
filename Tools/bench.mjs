#!/usr/bin/env node
// Measures a game's frame rate in Unreal: runs it off screen with a script and counts host frames
// over a window of seconds after the game is ready.
//   node Tools/bench.mjs <game> --script file --from 40 --to 100 [--res 2560x1440] [--dlss quality] [--tsr 67] [--frame-gen] [--onscreen]
// Frame Generation needs --onscreen: it works on a presented window, not an off-screen render.
// Prints one JSON line: average FPS and frame time over the window, and the GPU time samples.
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [game, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const from = +flag('--from', 30), to = +flag('--to', 90), res = flag('--res', '1920x1080');
const pass = [];
for (const f of ['--dlss', '--tsr', '--vibrance', '--dlss-preset', '--script', '--search']) if (flag(f)) pass.push(f, flag(f));
for (const f of ['--frame-gen', '--hud']) if (rest.includes(f)) pass.push(f);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const status = () => fetch('http://127.0.0.1:5292/bridge/status', {signal: AbortSignal.timeout(3000)}).then(r => r.json()).catch(() => null);

const child = spawn(process.execPath, [path.join(bridge, 'Tools/run-unreal.mjs'), game, ...(rest.includes('--onscreen') ? [] : ['--offscreen']), '--mute', '--res', res, '--timeout', String(to + 600), ...pass], {stdio: ['ignore', 'pipe', 'pipe']});
let out = '';
child.stdout.on('data', d => { out += d; });
const exited = new Promise(r => child.on('exit', r));
let ready = null, upscaler = '';
const samples = [];
for (;;) {
  const s = await status();
  if (s?.ready && ready === null) ready = Date.now();
  if (ready !== null && s) {
    const t = (Date.now() - ready) / 1000;
    upscaler = s.upscaler ?? upscaler;
    if (t >= from) samples.push({t, frames: s.hostFrames, gpuMs: s.gpuMs, presentedFps: s.presentedFps});
    if (t >= to) break;
  }
  if (child.exitCode !== null) break;
  await sleep(1000);
}
await fetch('http://127.0.0.1:5292/bridge/close', {method: 'POST', body: '', signal: AbortSignal.timeout(5000)}).catch(() => {});
await Promise.race([exited, sleep(60000)]);
if (child.exitCode === null) child.kill();
if (samples.length < 2) { console.log(JSON.stringify({game, res, upscaler, error: 'no samples', log: out.slice(-400)})); process.exit(1); }
const a = samples[0], b = samples.at(-1);
const fps = (b.frames - a.frames) / (b.t - a.t);
const gpu = samples.map(s => s.gpuMs).filter(x => x > 0).sort((x, y) => x - y);
console.log(JSON.stringify({game, res, upscaler, window: [+a.t.toFixed(1), +b.t.toFixed(1)], fps: +fps.toFixed(1), frameMs: +(1000 / fps).toFixed(2),
  gpuMsMedian: gpu.length ? +gpu[gpu.length >> 1].toFixed(2) : null,
  // With Frame Generation, the plugin's own count of frames on screen per second (median of the samples).
  presentedFps: (p => p.length ? +p[p.length >> 1].toFixed(1) : null)(samples.map(s => s.presentedFps).filter(x => x > 0).sort((x, y) => x - y))}));
