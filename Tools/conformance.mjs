#!/usr/bin/env node
// Conformance check for one game: from one source commit, build the browser and Unreal targets, run
// the same script on both (Tests/scripts/<game>.txt), and write a side-by-side film and stills.
//   node Tools/conformance.mjs <game> [--script file] [--fps 10] [--film out.mp4] [--no-film] [--out dir] [--skip-web] [--skip-unreal]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {loadGame, build} = await import(pathToFileURL(path.join(bridge, 'Tools/jsgb.mjs')).href);
const [gameArg, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const has = name => rest.includes(name);
const game = loadGame(gameArg);
const script = path.resolve(flag('--script', path.join(bridge, 'Tests/scripts', game.id + '.txt')));
const fps = +flag('--fps', 10);
const seed = flag('--seed', '1234');
// A query string both sides boot with (Games/<game>.json conformanceSearch), e.g. to fix a world seed.
const search = flag('--search', game.conformanceSearch ?? game.search ?? '');
// --out: where this run's frames, pairs, stills and report go (the suite runner gives each case its own).
const root = path.resolve(flag('--out', path.join(game.out, 'conformance')));
const webDir = path.join(root, 'web'), unrealDir = path.join(root, 'unreal'), pairDir = path.join(root, 'pairs');
const film = path.resolve(flag('--film', path.join(root, `${game.id}-side-by-side.mp4`)));
const node = process.execPath;
const git = (...a) => execFileSync('git', ['--no-optional-locks', '-C', game.repo, ...a], {encoding: 'utf8'}).trim();
const run = (args, label) => {
  console.log(`== ${label}`);
  const r = spawnSync(node, args, {cwd: bridge, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 1800000});
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  console.log(out.split(/\r?\n/).filter(l => l && !/duplicate-object-key|original key|^\s|~~~/.test(l)).slice(-12).join('\n'));
  return out;
};

const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=no').split('\n').filter(Boolean);
console.log(`${game.id} at ${commit}${dirty.length ? ` (${dirty.length} modified tracked files)` : ''}`);
const publication = await build(game);
if (publication.sourceCommit !== commit) throw Error('source moved during the Unreal build');
const report = {game: game.id, search, sourceCommit: commit, modifiedTrackedFiles: dirty.length, script: path.relative(bridge, script), fps};

if (!has('--skip-web')) {
  fs.rmSync(webDir, {recursive: true, force: true});
  run(['Tools/web.mjs', 'build', game.id], 'web build');
  if (git('rev-parse', 'HEAD') !== commit) throw Error('source moved during the web build');
  const out = run(['Tools/web.mjs', 'capture', game.id, '--script', script, '--frames', path.join(webDir, 'frames'), '--shots', webDir, '--fps', String(fps), '--res', '1280x720', '--seed', seed, '--fixed-fps', flag('--fixed-fps', '60'), ...(search ? ['--search', search] : [])], 'browser run');
  report.web = JSON.parse(out.trim().split(/\r?\n/).filter(l => l.startsWith('{')).pop() ?? '{}');
}
if (!has('--skip-unreal')) {
  fs.rmSync(unrealDir, {recursive: true, force: true});
  const out = run(['Tools/run-unreal.mjs', game.id, '--offscreen', '--fresh', '--res', '1280x720', '--script', script, '--capture', unrealDir, '--capture-fps', String(fps), '--fixed-fps', flag('--fixed-fps', '60'), '--timeout', '900', '--seed', seed, ...(search ? ['--search', search] : [])], 'Unreal run');
  report.unreal = {ready: /\nready /.test('\n' + out), status: JSON.parse(/ready (\{.*\})/.exec(out)?.[1] ?? '{}'), exited: /Unreal exited with 0/.test(out),
    errors: +(/(\d+) JsGameBridge errors/.exec(out)?.[1] ?? -1)};
}

// Pair frames segment by segment. Each "wait"/"gone" step ends a segment on both sides; the side
// that gets there first holds its last frame until the other side arrives, so a slower load shows
// as a held frame and both sides enter the next segment together.
function frames(dir) {
  const file = path.join(dir, 'times.txt');
  if (!fs.existsSync(file)) return {list: [], start: 0, anchors: []};
  const anchors = [], list = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [a, b, ...fields] = line.trim().split(' ');
    // Extra fields: objects=N (browser), drawn=N missing=N untextured=N (Unreal).
    const counts = Object.fromEntries(fields.map(f => f.split('=')).filter(([k, v]) => k && v !== undefined).map(([k, v]) => [k, +v]));
    if (a === 'wait-end') anchors.push(+b); else if (a && fs.existsSync(path.join(dir, a))) list.push({file: path.join(dir, a), t: +b, ...counts});
  }
  // Each "wait" ends at its own time on each side (Unreal may load slower); pairing re-aligns there.
  return {list, start: anchors[0] ?? 0, anchors};
}
const web = frames(path.join(webDir, 'frames')), unreal = frames(unrealDir);
fs.rmSync(pairDir, {recursive: true, force: true}); fs.mkdirSync(pairDir, {recursive: true});
const nearest = (side, t) => side.list.reduce((best, f) => Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best, side.list[0]);
const anchors = Math.min(web.anchors.length, unreal.anchors.length);
const bounds = side => [0, ...side.anchors.slice(0, anchors), side.list.length ? side.list[side.list.length - 1].t : 0];
const bw = bounds(web), bu = bounds(unreal);
let pairs = 0;
// The object check: every Unreal frame must draw all the objects the game drew, each with its
// own material, and no paired frame may draw fewer objects than the browser frame beside it.
// Pairs where one side is holding at a wait are compared only on the Unreal side's own counts.
const violations = [];
let checked = 0, compared = 0;
// Captures are 1/fps apart, and when the game swaps scenes its object count can change between two of them (and
// work that finishes on other threads lands a frame or two apart on the two sides), so each Unreal frame is held to
// the fewest objects the browser drew within two capture intervals of the pair. An object that stays missing still fails.
const around = (side, t) => {
  const near = side.list.filter(f => Math.abs(f.t - t) <= 2 / fps + 1e-6);
  if (!near.length) return null;
  const least = key => near.some(f => f[key] === undefined || f[key] < 0) ? -1 : Math.min(...near.map(f => f[key]));
  return {...near[0], objects: least('objects'), lines: least('lines'), sprites: least('sprites'), points: least('points')};
};
const check = (pair, w, ue, held) => {
  if (ue.drawn === undefined) return;
  checked++;
  const problems = [];
  if (ue.missing > 0) problems.push(`${ue.missing} objects missing in Unreal`);
  if (ue.untextured > 0) problems.push(`${ue.untextured} objects without their material in Unreal`);
  if (!held && w.objects >= 0 && w.objects !== undefined) { compared++; if (ue.drawn < w.objects) problems.push(`Unreal drew ${ue.drawn} objects, the browser ${w.objects}`); }
  // Line coverage: every segment of every visible line (rings, grids, routes) must be drawn.
  if (!held && w.lines >= 0 && ue.lines !== undefined && ue.lines < w.lines) problems.push(`Unreal drew ${ue.lines} line segments, the browser ${w.lines}`);
  // Billboards: sprites and points objects (markers, stars, particles).
  if (!held && w.sprites >= 0 && ue.sprites !== undefined && ue.sprites < w.sprites) problems.push(`Unreal drew ${ue.sprites} sprites, the browser ${w.sprites}`);
  if (!held && w.points >= 0 && ue.points !== undefined && ue.points < w.points) problems.push(`Unreal drew ${ue.points} points objects, the browser ${w.points}`);
  if (problems.length) violations.push({pair, film: +(pair / fps).toFixed(1), web: w.file && path.basename(w.file), unreal: path.basename(ue.file), problems});
};
for (let i = 0; i + 1 < bw.length && web.list.length && unreal.list.length; i++) {
  const dw = Math.max(0, bw[i + 1] - bw[i]), du = Math.max(0, bu[i + 1] - bu[i]);
  // Between anchors the film runs as long as the slower side; after the last one, until either side ends.
  const span = i + 2 < bw.length ? Math.max(dw, du) : Math.min(dw, du);
  for (let u = 0; u < span; u += 1 / fps, pairs++) {
    const w = nearest(web, bw[i] + Math.min(u, dw)), ue = nearest(unreal, bu[i] + Math.min(u, du));
    fs.copyFileSync(w.file, path.join(pairDir, `web_${String(pairs).padStart(5, '0')}.png`));
    fs.copyFileSync(ue.file, path.join(pairDir, `ue_${String(pairs).padStart(5, '0')}.png`));
    // A segment that ends at a wait is the game loading toward that state (the first scene, a planet), each side at
    // its own pace, so it isn't compared with the browser; Unreal's own missing and untextured counts still apply.
    // A frame captured before its own side's wait ended belongs to that earlier segment.
    const early = w.t < bw[i] - 1e-6 || ue.t < bu[i] - 1e-6;
    check(pairs, {...(around(web, w.t) ?? w), file: w.file}, ue, u > dw || u > du || i < anchors || early);
  }
}
report.pairs = pairs;
report.objectCheck = {pass: violations.length === 0 && checked > 0, unrealFramesChecked: checked, pairsCompared: compared, failures: violations.length, first: violations.slice(0, 20)};
console.log(report.objectCheck.pass ? `object check passed: ${checked} Unreal frames, ${compared} compared with the browser`
  : checked === 0 ? `OBJECT CHECK FAILED: no frames to check (the browser captured ${report.web?.frames ?? 0} and Unreal ${report.unreal?.frames ?? 0}; see the errors above)`
  : `OBJECT CHECK FAILED on ${violations.length} of ${checked} frames; first: ${JSON.stringify(violations.slice(0, 3))}`);
if (pairs > 1 && !has('--no-film')) {
  const font = 'C\\:/Windows/Fonts/arial.ttf';
  const label = (text, x) => `drawtext=fontfile='${font}':text='${text}':x=${x}:y=16:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8`;
  const filter = `[0:v]scale=1280:720,setsar=1,${label('Browser (Chrome, WebGL)', 16)}[a];[1:v]scale=1280:720,setsar=1,${label('Unreal Engine 5.8 (JsGameBridge)', 16)}[b];` +
    `[a][b]hstack=inputs=2,${label(`${game.title ?? game.id}  ${commit.slice(0, 10)}  same commit, same script`, '(w-text_w)/2').replace('y=16', 'y=h-48')}[v]`;
  fs.mkdirSync(path.dirname(film), {recursive: true});
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(pairDir, 'web_%05d.png'), '-framerate', String(fps), '-i', path.join(pairDir, 'ue_%05d.png'),
    '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '6M', '-minrate', '6M', '-maxrate', '6M', '-bufsize', '12M', '-x264-params', 'nal-hrd=cbr', '-preset', 'slow', '-r', '30', film], {encoding: 'utf8'});
  if (ff.status !== 0) throw Error('ffmpeg: ' + ff.stderr);
  report.film = film;
  console.log(`film: ${film} (${(pairs / fps).toFixed(1)} s)`);
}
// Named stills from the script's "shot" steps, side by side.
for (const name of fs.readFileSync(script, 'utf8').split(/\r?\n/).map(l => /^\S+\s+shot\s+(\S+)/.exec(l.trim())?.[1]).filter(Boolean)) {
  const a = path.join(webDir, name + '.png'), b = path.join(unrealDir, name + '.png');
  if (!fs.existsSync(a) || !fs.existsSync(b)) continue;
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex', '[0]scale=960:540[a];[1]scale=960:540[b];[a][b]hstack', path.join(root, `${name}-side-by-side.png`)]);
}
fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
if (!report.objectCheck.pass) process.exitCode = 1;
