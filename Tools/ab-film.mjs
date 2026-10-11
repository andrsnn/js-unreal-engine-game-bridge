#!/usr/bin/env node
// Films the same game twice in Unreal with different rendering settings (for example DLSS off and on)
// and puts them side by side, with a zoomed crop of each under it.
//   node Tools/ab-film.mjs <game> --script file --seconds 20 --res 2560x1440 --b "--dlss quality"
//        [--a ""] [--label-a "DLSS off"] [--label-b "DLSS Quality"] [--crop x,y,w,h] [--note text]
//        [--out film.mp4] [--still image.png] [--still-at 12] [--work dir] [--skip seconds] [--reuse] [--search ?x] [--seed 42] [--after-wait]
// Both runs step game time at exactly 1/30 s per frame and seed Math.random the same way, so frame N
// shows the same moment in both.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [game, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const res = flag('--res', '2560x1440'), [W, H] = res.split('x').map(Number);
const seconds = +flag('--seconds', 20), fps = 30;
const work = path.resolve(flag('--work', path.join('F:/JsgbCaptures', `${game}-ab`)));
const out = path.resolve(flag('--out', path.join(work, `${game}-ab.mp4`)));
const [cx, cy, cw, ch] = (flag('--crop', `${W * 0.4 | 0},${H * 0.35 | 0},${W / 4 | 0},${H / 4 | 0}`)).split(',').map(Number);
const labelA = flag('--label-a', 'A'), labelB = flag('--label-b', 'B'), note = flag('--note', '');
const script = path.resolve(flag('--script'));

function capture(name, extra) {
  const dir = path.join(work, name);
  // --reuse composes from frames an earlier run captured.
  if (rest.includes('--reuse') && fs.existsSync(dir)) return {dir, frames: fs.readdirSync(dir).filter(f => /^frame_\d+\.png$/.test(f)).sort()};
  fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true});
  const args = [path.join(bridge, 'Tools/run-unreal.mjs'), game, '--offscreen', '--mute', '--res', res, '--script', script, '--capture', dir, '--capture-fps', String(fps), '--fixed-fps', String(fps), '--timeout', '1800', ...(flag('--search') ? ['--search', flag('--search')] : []), '--seed', flag('--seed', '42'),
    ...(extra.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map(a => a.replace(/"/g, ''))];
  console.log(`capturing ${name}: ${extra || '(default settings)'}`);
  const r = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 1900000});
  console.log(r.stdout.split('\n').filter(l => /exited|errors|Anti-aliasing/.test(l)).join('\n'));
  const frames = fs.readdirSync(dir).filter(f => /^frame_\d+\.png$/.test(f)).sort();
  if (!frames.length) throw Error(`no frames captured for ${name}`);
  return {dir, frames};
}
const a = capture('a', flag('--a', '')), b = capture('b', flag('--b', ''));
// --skip leaves out the first seconds (loading screens). With --after-wait it counts from the end of
// the script's last wait in each run, so both clips start at the same moment in the game.
function startFrame(run) {
  let t = +flag('--skip', 0);
  if (rest.includes('--after-wait')) {
    const lines = fs.readFileSync(path.join(run.dir, 'times.txt'), 'utf8').split(/\r?\n/);
    const waits = lines.filter(l => l.startsWith('wait-end ')).map(l => +l.split(' ')[1]);
    if (waits.length) t += waits.at(-1);
  }
  const i = run.frames.findIndex((f, k) => k / fps >= t - 1e-6);
  return i < 0 ? run.frames.length : i;
}
const startA = startFrame(a), startB = startFrame(b);
const n = Math.max(0, Math.min(a.frames.length - startA, b.frames.length - startB, seconds * fps));
const pairs = path.join(work, 'pairs');
fs.rmSync(pairs, {recursive: true, force: true}); fs.mkdirSync(pairs);
for (let i = 0; i < n; i++) {
  fs.copyFileSync(path.join(a.dir, a.frames[startA + i]), path.join(pairs, `a_${String(i).padStart(5, '0')}.png`));
  fs.copyFileSync(path.join(b.dir, b.frames[startB + i]), path.join(pairs, `b_${String(i).padStart(5, '0')}.png`));
}

// 1920x1080: the two full frames on top, and the same crop of each, enlarged, underneath.
const bold = 'C\\:/Windows/Fonts/arialbd.ttf';
const esc = t => t.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\u2019");
const text = (t, x, y, size, color = 'white') => `drawtext=fontfile='${bold}':text='${esc(t)}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}:box=1:boxcolor=black@0.6:boxborderw=8`;
const zoom = (960 / cw).toFixed(1);
const filter = `[0:v]split[a1][a2];[1:v]split[b1][b2];` +
  `[a1]scale=960:540:flags=lanczos,${text(labelA, 16, 16, 30)}[ta];[b1]scale=960:540:flags=lanczos,${text(labelB, 16, 16, 30, '#7dffa8')}[tb];` +
  `[a2]crop=${cw}:${ch}:${cx}:${cy},scale=960:540:flags=neighbor,${text(`${labelA}, ${zoom}x zoom`, 16, 16, 24)}[za];` +
  `[b2]crop=${cw}:${ch}:${cx}:${cy},scale=960:540:flags=neighbor,${text(`${labelB}, ${zoom}x zoom`, 16, 16, 24, '#7dffa8')}[zb];` +
  `[ta][tb]hstack[top];[za][zb]hstack[bottom];[top][bottom]vstack,drawbox=x=0:y=538:w=1920:h=4:color=black@1:t=fill,drawbox=x=958:y=0:w=4:h=1080:color=black@1:t=fill` +
  (note ? `,${text(note, '(w-text_w)/2', 'h-56', 30, '#ffd159')}` : '') + '[v]';
fs.mkdirSync(path.dirname(out), {recursive: true});
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(pairs, 'a_%05d.png'), '-framerate', String(fps), '-i', path.join(pairs, 'b_%05d.png'),
  '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-preset', 'slow', '-r', String(fps), out], {encoding: 'utf8'});
if (ff.status !== 0) throw Error('ffmpeg: ' + ff.stderr);
const still = flag('--still');
if (still) {
  const at = Math.min(n - 1, Math.round(+flag('--still-at', n / fps / 2) * fps));
  // The still comes from the captured PNG frames, not the compressed film.
  fs.mkdirSync(path.dirname(path.resolve(still)), {recursive: true});
  const s = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-start_number', String(at), '-i', path.join(pairs, 'a_%05d.png'), '-start_number', String(at), '-i', path.join(pairs, 'b_%05d.png'),
    '-filter_complex', filter, '-map', '[v]', '-frames:v', '1', path.resolve(still)], {encoding: 'utf8'});
  if (s.status !== 0) throw Error('ffmpeg still: ' + s.stderr);
}
console.log(JSON.stringify({game, res, frames: n, out, still: still ? path.resolve(still) : null, crop: [cx, cy, cw, ch], a: flag('--a', ''), b: flag('--b', '')}));
