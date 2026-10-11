#!/usr/bin/env node
// Films the live-edit demo: the browser (Vite dev server) and Unreal side by side while one
// stylesheet is saved, and measures when the change shows on each side.
//   node Tools/liveedit.mjs <game> --out film.mp4 [--search ?x] [--off] [--fps 30]
// The game needs the demo feature (Tools/demo.mjs feature on|off), a CSS rule that adds a "LIVE EDIT"
// label. Vite updates the browser's stylesheet in place, and the Unreal overlay swaps its stylesheet
// while the game keeps running. Both sides are filmed at 1920x1080 with wall-clock timestamps.
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {loadGame} = await import(pathToFileURL(path.join(bridge, 'Tools/jsgb.mjs')).href);
const [gameArg, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const game = loadGame(gameArg);
const search = flag('--search', game.conformanceSearch ?? '');
const fps = +flag('--fps', 30);
const W = 1920, H = 1080;
const film = path.resolve(flag('--out', path.join(game.out, 'liveedit', `${game.id}-liveedit.mp4`)));
const work = path.join(game.out, 'liveedit');
const webDir = path.join(work, 'web'), ueDir = path.join(work, 'unreal');
for (const d of [webDir, ueDir]) { fs.rmSync(d, {recursive: true, force: true}); fs.mkdirSync(d, {recursive: true}); }
const sheet = path.join(game.repo, 'src/ui/style.css');
const demo = on => { spawnSync(process.execPath, [path.join(bridge, 'Tools/demo.mjs'), 'feature', on ? 'on' : 'off'], {encoding: 'utf8'}); return fs.statSync(sheet).mtimeMs; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = text => console.log(`[liveedit ${new Date().toISOString().slice(11, 19)}] ${text}`);
const host = 'http://127.0.0.1:5292/bridge';
const ue = async (route, body) => fetch(`${host}/${route}`, {method: 'POST', body, signal: AbortSignal.timeout(10000)}).then(r => r.json()).catch(() => null);
const ueStatus = async () => fetch(`${host}/status`, {signal: AbortSignal.timeout(5000)}).then(r => r.json()).catch(() => ({}));
const waitFor = async (test, ms, what) => { log('waiting for ' + what); const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await sleep(100); } throw Error('timed out waiting for ' + what); };

demo(false);
// Browser: the game's Vite dev server. Unreal: build, start, and send every save.
const webPort = 5420;
const webLog = [], ueLog = [];
const vite = spawn(process.execPath, [path.join(bridge, 'Tools/web.mjs'), 'dev', game.id, '--no-open', '--port', String(webPort)], {stdio: ['ignore', 'pipe', 'pipe']});
vite.stdout.on('data', d => webLog.push(String(d)));
const unreal = spawn(process.execPath, [path.join(bridge, 'Tools/jsgb.mjs'), 'unreal', game.id, '--offscreen', '--mute', '--res', `${W}x${H}`, '--timeout', '1800', ...(search ? ['--search', search] : [])], {stdio: ['ignore', 'pipe', 'pipe']});
unreal.stdout.on('data', d => ueLog.push(String(d)));
unreal.stderr.on('data', d => ueLog.push(String(d)));
await waitFor(() => webLog.join('').includes('serving'), 120000, 'the Vite dev server');
await waitFor(() => ueLog.join('').includes('watching'), 900000, 'Unreal to start');

const requireFromGame = createRequire(path.join(game.repo, 'package.json'));
const playwright = await import(pathToFileURL(requireFromGame.resolve('playwright')).href);
const chromium = playwright.chromium ?? playwright.default.chromium;
const browser = await chromium.launch({headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: W, height: H}});
const cssShownMs = [];
page.on('console', m => { const x = /\[jsgb\] css update shown after (\d+) ms/.exec(m.text()); if (x) cssShownMs.push(+x[1]); });
await page.goto(`http://localhost:${webPort}/${search}`, {waitUntil: 'load', timeout: 120000});
const webLoaded = async () => page.evaluate(() => !!document.body && !document.querySelector('#startup')).catch(() => false);
const ueLoaded = async () => String((await ue('eval', '!!document.body&&!document.querySelector("#startup")'))?.result) === 'true';
await waitFor(async () => (await webLoaded()) && (await ueLoaded()), 600000, 'both games to finish loading');
// The label is in the browser once its stylesheet rule applies; in Unreal once the overlay reports it painted the new stylesheet.
const webLabel = async () => page.evaluate(() => getComputedStyle(document.body, '::after').content.includes('LIVE EDIT')).catch(() => null);

// Filming: Chrome's screencast and the Unreal host's recorder, both stamped with Unix milliseconds.
const webFrames = [];
const cdp = await page.context().newCDPSession(page);
let webIndex = 0;
cdp.on('Page.screencastFrame', f => {
  cdp.send('Page.screencastFrameAck', {sessionId: f.sessionId}).catch(() => {});
  const file = path.join(webDir, `frame_${String(webIndex++).padStart(5, '0')}.jpg`);
  webFrames.push({ms: f.metadata.timestamp * 1000, file});
  fs.writeFile(file, Buffer.from(f.data, 'base64'), () => {});
});
log('filming');
await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1});
await ue('record', `${ueDir.replaceAll('\\', '/')}|${fps}`);
const t0 = Date.now();

// One save, measured from the file's modification time.
async function measure(on) {
  const before = ueLog.join('').length, shownBefore = cssShownMs.length, cssBefore = (await ueStatus()).cssAppliedVersion ?? -1;
  const savedMs = demo(on);
  log(`saved (feature ${on ? 'on' : 'off'})`);
  let web = null, unrealShown = null;
  await waitFor(async () => {
    if (web === null && (await webLabel()) === on) web = Date.now() - savedMs;
    if (unrealShown === null && ((await ueStatus()).cssAppliedVersion ?? -1) > cssBefore) unrealShown = Date.now() - savedMs;
    return web !== null && unrealShown !== null;
  }, 120000, 'the change on both sides');
  await waitFor(() => /hot reload \(CSS\) of .*\n/.test(ueLog.join('').slice(before)), 30000, 'the Unreal timing line');
  const line = /hot reload \(CSS\) of \S+: build ([\d.]+) s \+ Unreal ([\d.]+) s = ([\d.]+) s/.exec(ueLog.join('').slice(before));
  await waitFor(() => cssShownMs.length > shownBefore, 10000, 'the browser timing banner').catch(() => {});
  return {feature: on ? 'on' : 'off', savedAt: new Date(savedMs).toISOString(), savedMs,
    bundleRebuildMs: line ? Math.round(+line[1] * 1000) : null, unrealOverlayMs: line ? Math.round(+line[2] * 1000) : null,
    browserBannerMs: cssShownMs.length > shownBefore ? cssShownMs.at(-1) : null,
    browserStyleAppliedMs: web, unrealStylePaintedMs: unrealShown};
}
await sleep(5000);
const results = [await measure(true)];
await sleep(6000);
if (rest.includes('--off')) { results.push(await measure(false)); await sleep(6000); }
const tEnd = Date.now();
await cdp.send('Page.stopScreencast');
await ue('record', '');
log(`saves measured: ${JSON.stringify(results)}`);
await browser.close();
await ue('close', '');
vite.kill();
await sleep(3000);
unreal.kill();
demo(false);

// Unreal frames and their wall-clock times.
await waitFor(() => fs.existsSync(path.join(ueDir, 'times.txt')), 20000, 'the Unreal frame list');
const ueFrames = fs.readFileSync(path.join(ueDir, 'times.txt'), 'utf8').trim().split('\n').map(l => { const [name, ms] = l.trim().split(' '); return {ms: +ms, file: path.join(ueDir, name)}; })
  .filter(f => fs.existsSync(f.file));
log(`frames: browser ${webFrames.length}, Unreal ${ueFrames.length}`);

// The label's pixels, read from every frame: a patch of its top padding, which is a flat orange (#ffb43c).
function labelVisible(frames) {
  const list = path.join(work, 'list.txt');
  fs.writeFileSync(list, frames.map(f => `file '${f.file.replaceAll('\\', '/')}'\nduration 0.033`).join('\n'));
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=${W}:${H},crop=8:4:956:63,scale=1:1:flags=area`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 26});
  const px = r.stdout ?? Buffer.alloc(0);
  return frames.map((f, i) => { const [R, G, B] = [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]]; return R > 215 && G > 140 && G < 215 && B < 110; });
}
const webSeen = labelVisible(webFrames), ueSeen = labelVisible(ueFrames);
// First filmed frame after the save whose label state matches the change.
const firstShown = (frames, seen, save, on) => { const i = frames.findIndex((f, k) => f.ms >= save.savedMs && seen[k] === on); return i < 0 ? null : Math.round(frames[i].ms - save.savedMs); };
for (const s of results) {
  s.browserLabelInFrameMs = firstShown(webFrames, webSeen, s, s.feature === 'on');
  s.unrealLabelInFrameMs = firstShown(ueFrames, ueSeen, s, s.feature === 'on');
}

// Pair frames on the shared clock: each side shows the newest frame it had drawn by that moment.
const newest = (list, ms) => { let lo = 0, hi = list.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (list[mid].ms <= ms) lo = mid; else hi = mid - 1; } return list[lo]; };
const pairs = path.join(work, 'pairs');
fs.rmSync(pairs, {recursive: true, force: true}); fs.mkdirSync(pairs);
const start = Math.max(t0, webFrames[0].ms, ueFrames[0].ms), end = Math.min(tEnd, webFrames.at(-1).ms, ueFrames.at(-1).ms);
let n = 0;
for (let ms = start; ms <= end; ms += 1000 / fps, n++) {
  fs.copyFileSync(newest(webFrames, ms).file, path.join(pairs, `web_${String(n).padStart(5, '0')}.jpg`));
  fs.copyFileSync(newest(ueFrames, ms).file, path.join(pairs, `ue_${String(n).padStart(5, '0')}.jpg`));
}

// 1920x1080 film: the two games side by side, and a timer under each that runs from the save until that side shows the change.
const bold = 'C\\:/Windows/Fonts/arialbd.ttf';
const text = (t, x, y, size, color = 'white', extra = '') => `drawtext=fontfile='${bold}':text='${t}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}${extra}`;
const sw = 944, sh = 531, top = 170, lx = 16, rx = 960;
const timers = [];
for (const s of results) {
  const at = (s.savedMs - start) / 1000;
  for (const [x, shownMs] of [[lx, s.browserLabelInFrameMs], [rx, s.unrealLabelInFrameMs]]) {
    if (shownMs === null) continue;
    const done = at + shownMs / 1000, verb = s.feature === 'on' ? 'Label shown' : 'Label removed';
    const running = `Since save\\: %{eif\\:trunc(t-${at.toFixed(3)})\\:d}.%{eif\\:mod(trunc((t-${at.toFixed(3)})*100)\\,100)\\:d\\:2} s`;
    timers.push(text(running, `${x}+(${sw}-text_w)/2`, top + sh + 40, 44, '#ffd159', `:enable='between(t,${at.toFixed(3)},${done.toFixed(3)})'`));
    timers.push(text(`${verb} ${(shownMs / 1000).toFixed(2)} s after save`, `${x}+(${sw}-text_w)/2`, top + sh + 40, 44, '#7dffa8', `:enable='between(t,${done.toFixed(3)},${(at + (s.feature === 'on' ? 11 : 6)).toFixed(3)})'`));
  }
  timers.push(text(`Saved src/ui/style.css (${s.feature === 'on' ? 'label added' : 'label removed'})`, '(w-text_w)/2', top + sh + 120, 32, 'white', `:enable='between(t,${at.toFixed(3)},${(at + 6).toFixed(3)})'`));
}
const filter = `color=c=0x0b0f14:s=${W}x${H}:r=${fps}[bg];[0:v]scale=${sw}:${sh},setsar=1[a];[1:v]scale=${sw}:${sh},setsar=1[b];` +
  `[bg][a]overlay=${lx}:${top}:shortest=1[ba];[ba][b]overlay=${rx}:${top}[v0];` +
  `[v0]${text(`${game.title ?? game.id}\\: one CSS edit, live in the browser and in Unreal`, '(w-text_w)/2', 40, 46)},` +
  `${text('Browser (Chrome, Vite dev server)', `${lx}+(${sw}-text_w)/2`, top - 50, 30, '#cfd8e3')},` +
  `${text('Unreal Engine 5.8 (JsGameBridge)', `${rx}+(${sw}-text_w)/2`, top - 50, 30, '#cfd8e3')},${timers.join(',')}[v]`;
fs.mkdirSync(path.dirname(film), {recursive: true});
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(pairs, 'web_%05d.jpg'), '-framerate', String(fps), '-i', path.join(pairs, 'ue_%05d.jpg'),
  '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '8M', '-minrate', '8M', '-maxrate', '8M', '-bufsize', '16M', '-x264-params', 'nal-hrd=cbr', '-preset', 'slow', '-r', String(fps), film], {encoding: 'utf8'});
if (ff.status !== 0) throw Error('ffmpeg: ' + ff.stderr);
const json = {game: game.id, film, size: `${W}x${H}`, fps, filmSeconds: +(n / fps).toFixed(1), filmStartUnixMs: Math.round(start),
  browserFramesPerSecond: +(webFrames.length / ((tEnd - t0) / 1000)).toFixed(1), unrealFramesPerSecond: +(ueFrames.length / ((tEnd - t0) / 1000)).toFixed(1),
  change: 'One rule added to (and later removed from) src/ui/style.css that adds a LIVE EDIT label. No game code changes.',
  note: 'All times are milliseconds after the file was saved (its modification time), on one wall clock. "InFrame" is the first filmed frame that shows the change, read from the label pixels. ' +
    '"browserBannerMs" is the in-page timer from the Vite CSS update. "unrealOverlayMs" is from the bridge receiving the new stylesheet to the overlay painting it, after a "bundleRebuildMs" build.',
  saves: results.map(s => ({...s, savedAtFilmSeconds: +((s.savedMs - start) / 1000).toFixed(2)}))};
fs.writeFileSync(film.replace(/\.mp4$/, '.json'), JSON.stringify(json, null, 2));
console.log(JSON.stringify(json, null, 1));
