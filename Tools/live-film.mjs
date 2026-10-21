#!/usr/bin/env node
// Real-time side-by-side film of one game in the browser and in Unreal, with each side's measured frame rate on
// screen. Each side runs on its own (one at a time) with the same script, filmed live, and the two films are lined
// up on one script step (the anchor) and cut to the same length.
//   node Tools/live-film.mjs <game> --script file --anchor <wait/gone target> --seconds 40 --out film.mp4
//        [--after 8] [--res 1280x720] [--search ?q] [--js-thread] [--skip-web] [--skip-unreal]
// The frame rate drawn on each side is the number of frames that side rendered in each second: requestAnimationFrame
// callbacks in Chrome, and Unreal's own frame times. Filming costs some frames on both sides.
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {loadGame, build} = await import(pathToFileURL(path.join(bridge, 'Tools/jsgb.mjs')).href);
const [gameArg, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const game = loadGame(gameArg);
const script = path.resolve(flag('--script'));
const anchor = flag('--anchor');
const seconds = +flag('--seconds', 40);
// The film starts this many seconds after the anchor step finishes (a game may still be fading in).
const after = +flag('--after', 0);
const res = flag('--res', '1280x720');
const search = flag('--search', game.search ?? '');
const out = path.resolve(flag('--out', path.join(game.out, 'live-film', `${game.id}-live.mp4`)));
const work = path.join(game.out, 'live-film');
const webDir = path.join(work, 'web'), ueDir = path.join(work, 'unreal');
const fps = 30, W = 1920, H = 1080;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = t => console.log(`[live-film ${new Date().toISOString().slice(11, 19)}] ${t}`);
const host = 'http://127.0.0.1:5292/bridge';
const post = (route, body) => fetch(`${host}/${route}`, {method: 'POST', body, signal: AbortSignal.timeout(10000)}).then(r => r.text()).catch(() => null);
if (!anchor) throw Error('--anchor <the wait or gone target the films line up on> is required');

// The script both sides run: the given steps, then a quit long enough after the last step to film the anchor
// plus the requested seconds.
const steps = fs.readFileSync(script, 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#') && !/^\s*\S+\s+quit\b/.test(l));
const last = Math.max(...steps.map(l => +l.trim().split(/\s+/)[0]));
fs.mkdirSync(work, {recursive: true});
const runScript = path.join(work, 'script.txt');
fs.writeFileSync(runScript, [...steps, `${last + after + seconds + 8} quit`].join('\n') + '\n');

// Display power switches stall the GPU on an idle PC; keep the display on, as for a player at the screen.
const awake = process.platform === 'win32' ? spawn('powershell', ['-NoProfile', '-Command',
  "Add-Type -Namespace Jsgb -Name Power -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);';" +
  "[void][Jsgb.Power]::SetThreadExecutionState([Convert]::ToUInt32('80000003',16)); Start-Sleep -Seconds 3600"], {stdio: 'ignore'}) : null;

if (!rest.includes('--skip-web')) {
  log('browser run');
  await build(game);
  const r = spawnSync(process.execPath, [path.join(bridge, 'Tools/web.mjs'), 'capture', game.id, '--script', runScript, '--res', res, '--live', webDir,
    '--shots', path.join(work, 'web-shots'), ...(search ? ['--search', search] : [])], {encoding: 'utf8', timeout: 1800000});
  console.log((r.stdout ?? '').trim().split('\n').slice(-4).join('\n'), (r.stderr ?? '').slice(-400));
}

if (!rest.includes('--skip-unreal')) {
  log('Unreal run');
  fs.rmSync(ueDir, {recursive: true, force: true}); fs.mkdirSync(ueDir, {recursive: true});
  const child = spawn(process.execPath, [path.join(bridge, 'Tools/run-unreal.mjs'), game.id, '--offscreen', '--mute', '--res', res, '--script', runScript,
    '--timeout', String(last + after + seconds + 300), ...(rest.includes('--js-thread') ? ['--js-thread'] : []), ...(search ? ['--search', search] : [])], {stdio: ['ignore', 'pipe', 'pipe']});
  let text = '';
  child.stdout.on('data', d => { text += d; });
  const exited = new Promise(r => child.on('exit', r));
  while (!/^ready /m.test(text) && child.exitCode === null) await sleep(500);
  // Film from the start of the game, clear the frame times once, and read them once at the end:
  // each request is handled on the game thread, so there are only these three.
  await post('record', `${ueDir.replaceAll('\\', '/')}|${fps}`);
  const t0 = Date.now();
  await fetch(`${host}/frametimes`, {signal: AbortSignal.timeout(5000)}).catch(() => null);
  const logFile = /log (\S+\.log)/.exec(text)?.[1];
  let anchorMs = null;
  while (anchorMs === null && child.exitCode === null) {
    await sleep(1000);
    const line = fs.readFileSync(logFile, 'utf8').split('\n').find(l => l.includes(anchor) && / done after /.test(l));
    const m = line && /\[(\d+)\.(\d+)\.(\d+)-(\d+)\.(\d+)\.(\d+):(\d+)\]/.exec(line);
    if (m) anchorMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
  }
  await sleep(Math.max(0, anchorMs + (after + seconds + 2) * 1000 - Date.now()));
  const readAt = Date.now();
  const times = await fetch(`${host}/frametimes`, {signal: AbortSignal.timeout(10000)}).then(r => r.json()).catch(() => []);
  await post('record', '');
  await sleep(3000);
  await post('close', '');
  await Promise.race([exited, sleep(60000)]);
  if (child.exitCode === null) child.kill();
  // Frame end times, counted back from the moment the list was read.
  const ends = [];
  let t = readAt;
  for (let i = times.length - 1; i >= 0; i--) { ends.push(t); t -= times[i]; }
  ends.reverse();
  fs.writeFileSync(path.join(ueDir, 'frames.json'), JSON.stringify(ends.filter(e => e >= t0).map(Math.round)));
  fs.writeFileSync(path.join(ueDir, 'anchors.txt'), `anchor ${anchor} ${anchorMs}`);
}

awake?.kill();

// Line both films up on the anchor and cut them to the same length.
const framesOf = dir => fs.readFileSync(path.join(dir, 'times.txt'), 'utf8').trim().split('\n').map(l => { const [name, ms] = l.trim().split(' '); return {ms: +ms, file: path.join(dir, name)}; })
  .filter(f => fs.existsSync(f.file)).sort((a, b) => a.ms - b.ms);
const anchorOf = dir => +fs.readFileSync(path.join(dir, 'anchors.txt'), 'utf8').trim().split('\n').filter(l => l.includes(anchor)).at(-1).split(' ').at(-1);
const webFrames = framesOf(webDir), ueFrames = framesOf(ueDir);
const webAnchor = anchorOf(webDir) + after * 1000, ueAnchor = anchorOf(ueDir) + after * 1000;
const webRaf = JSON.parse(fs.readFileSync(path.join(webDir, 'raf.json'), 'utf8')), ueEnds = JSON.parse(fs.readFileSync(path.join(ueDir, 'frames.json'), 'utf8'));
const newest = (list, ms) => { let lo = 0, hi = list.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (list[mid].ms <= ms) lo = mid; else hi = mid - 1; } return list[lo]; };
const pairs = path.join(work, 'pairs');
fs.rmSync(pairs, {recursive: true, force: true}); fs.mkdirSync(pairs);
const n = Math.round(seconds * fps);
for (let i = 0; i < n; i++) {
  fs.copyFileSync(newest(webFrames, webAnchor + i * 1000 / fps).file, path.join(pairs, `web_${String(i).padStart(5, '0')}.jpg`));
  fs.copyFileSync(newest(ueFrames, ueAnchor + i * 1000 / fps).file, path.join(pairs, `ue_${String(i).padStart(5, '0')}.jpg`));
}
// Frames rendered in each second of the film, per side.
const perSecond = (stamps, a) => Array.from({length: seconds}, (_, s) => stamps.filter(x => x >= a + s * 1000 && x < a + (s + 1) * 1000).length);
const webFps = perSecond(webRaf, webAnchor), ueFps = perSecond(ueEnds, ueAnchor);
const stats = list => { const s = [...list].sort((x, y) => x - y); return {min: s[0], median: s[s.length >> 1], max: s.at(-1)}; };

const bold = 'C\\:/Windows/Fonts/arialbd.ttf';
const text = (t, x, y, size, color = 'white', extra = '') => `drawtext=fontfile='${bold}':text='${t}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}${extra}`;
const sw = 944, sh = 531, top = 170, lx = 16, rx = 960;
const counters = [];
for (const [x, list, label] of [[lx, webFps, 'Chrome'], [rx, ueFps, 'Unreal']]) {
  list.forEach((v, s) => counters.push(text(`${label}\\: ${v} FPS`, `${x}+(${sw}-text_w)/2`, top + sh + 30, 52, v >= 60 ? '#7dffa8' : '#ffd159', `:enable='gte(t,${s})*lt(t,${s + 1})'`)));
}
const ws = stats(webFps), us = stats(ueFps);
const filter = `color=c=0x0b0f14:s=${W}x${H}:r=${fps}[bg];[0:v]scale=${sw}:${sh},setsar=1[a];[1:v]scale=${sw}:${sh},setsar=1[b];` +
  `[bg][a]overlay=${lx}:${top}:shortest=1[ba];[ba][b]overlay=${rx}:${top}[v0];` +
  `[v0]${text(`${game.title ?? game.id}\\: the same game in Chrome and in Unreal, live`, '(w-text_w)/2', 40, 46)},` +
  `${text('Chrome (headless, GPU, capped at 60 by the display)', `${lx}+(${sw}-text_w)/2`, top - 50, 28, '#cfd8e3')},` +
  `${text('Unreal Engine 5.8 (JsGameBridge, no frame cap)', `${rx}+(${sw}-text_w)/2`, top - 50, 28, '#cfd8e3')},` +
  `${text(`Frames rendered each second. Chrome ${ws.min} to ${ws.max} (median ${ws.median}). Unreal ${us.min} to ${us.max} (median ${us.median}).`, '(w-text_w)/2', top + sh + 120, 28, '#cfd8e3')},` +
  `${text(`Each side ran on its own on one RTX 4090 PC, at ${res}, filmed while it ran.`, '(w-text_w)/2', top + sh + 165, 28, '#cfd8e3')},${counters.join(',')}[v]`;
fs.mkdirSync(path.dirname(out), {recursive: true});
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(pairs, 'web_%05d.jpg'), '-framerate', String(fps), '-i', path.join(pairs, 'ue_%05d.jpg'),
  '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '8M', '-preset', 'slow', '-r', String(fps), out], {encoding: 'utf8', maxBuffer: 1 << 26});
if (ff.status !== 0) throw Error('ffmpeg: ' + ff.stderr);
const report = {game: game.id, film: out, seconds, res, anchor, oneSideAtATime: true, chromeFps: {...ws, perSecond: webFps}, unrealFps: {...us, perSecond: ueFps}};
fs.writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({...report, chromeFps: ws, unrealFps: us}));
