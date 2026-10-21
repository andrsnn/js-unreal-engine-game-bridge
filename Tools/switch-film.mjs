#!/usr/bin/env node
// Films one Unreal run that switches rendering mode partway through (a script step "upscaler dlaa"),
// for a before-and-after of the same moment: the frame with a zoomed crop, and the mode on screen.
//   node Tools/switch-film.mjs <game> --script file --res 2560x1440 [--before 6] [--after 6]
//        [--crop x,y,w,h] [--caption text] [--out film.mp4] [--still image.png] [--search ?x] [--work dir]
// The script's "upscaler" step is the switch. Game time steps at exactly 1/30 s per frame.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [game, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const res = flag('--res', '2560x1440'), [W, H] = res.split('x').map(Number), fps = 30;
const work = path.resolve(flag('--work', path.join('F:/JsgbCaptures', `${game}-switch`)));
const out = path.resolve(flag('--out', path.join(work, `${game}-switch.mp4`)));
const [cx, cy, cw, ch] = flag('--crop', `${W * 0.4 | 0},${H * 0.35 | 0},${W / 6 | 0},${H / 6 | 0}`).split(',').map(Number);
const before = +flag('--before', 6), after = +flag('--after', 6);
const dir = path.join(work, 'frames');

if (!rest.includes('--reuse')) {
  fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true});
  const args = [path.join(bridge, 'Tools/run-unreal.mjs'), game, '--offscreen', '--mute', '--hud', '--res', res, '--script', path.resolve(flag('--script')), '--capture', dir,
    '--capture-fps', String(fps), '--fixed-fps', String(fps), '--seed', flag('--seed', '42'), '--timeout', '1800', ...(flag('--search') ? ['--search', flag('--search')] : [])];
  const r = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 1900000});
  console.log(r.stdout.split('\n').filter(l => /exited|errors/.test(l)).join('\n'));
}
const lines = fs.readFileSync(path.join(dir, 'times.txt'), 'utf8').split(/\r?\n/);
const frames = lines.filter(l => l.startsWith('frame_')).map(l => { const [file, t] = l.split(' '); return {file: path.join(dir, file), t: +t}; });
const switchLine = lines.find(l => l.startsWith('upscaler '));
if (!switchLine) throw Error('the capture has no "upscaler" step; add one to the script');
const switchT = +switchLine.split(' ')[1], mode = switchLine.split(' ').slice(2).join(' ');
const at = t => { const i = frames.findIndex(f => f.t >= t - 1e-6); return i < 0 ? frames.length - 1 : i; };
const first = at(switchT - before), last = at(switchT + after);
const clip = path.join(work, 'clip');
fs.rmSync(clip, {recursive: true, force: true}); fs.mkdirSync(clip);
for (let i = first; i <= last; i++) fs.copyFileSync(frames[i].file, path.join(clip, `f_${String(i - first).padStart(5, '0')}.png`));

// The full frame, a 3x crop in the corner, and a caption.
const bold = 'C\\:/Windows/Fonts/arialbd.ttf';
const esc = t => t.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", '\u2019');
const text = (t, x, y, size, color = 'white', extra = '') => `drawtext=fontfile='${bold}':text='${esc(t)}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}:box=1:boxcolor=black@0.65:boxborderw=10${extra}`;
const switchAt = (frames[at(switchT)].t - frames[first].t).toFixed(3);
const inset = 640, insetH = 360;
const filter = `[0:v]split[f][z];[f]scale=1920:1080:flags=lanczos[full];[z]crop=${cw}:${ch}:${cx}:${cy},scale=${inset}:${insetH}:flags=neighbor,drawbox=x=0:y=0:w=${inset}:h=${insetH}:color=white@0.9:t=3[zoom];` +
  `[full]drawbox=x=${cx * 1920 / W | 0}:y=${cy * 1080 / H | 0}:w=${cw * 1920 / W | 0}:h=${ch * 1080 / H | 0}:color=white@0.9:t=2[marked];[marked][zoom]overlay=W-w-24:H-h-120[v0];` +
  // The game's own readout (top right) names the mode; a banner marks the switch for two seconds.
  `[v0]${text('DLSS turns on now', '(w-text_w)/2', 'h-160', 40, '#7dffa8', `:enable='between(t,${switchAt},${(+switchAt + 2).toFixed(3)})'`)},` +
  `${text(`${(inset / cw).toFixed(1)}x zoom`, `W-${inset}-24`, `H-${insetH}-120-52`, 28)}` +
  (flag('--caption') ? `,${text(flag('--caption'), '(w-text_w)/2', 'h-80', 30, '#ffd159')}` : '') + '[v]';
fs.mkdirSync(path.dirname(out), {recursive: true});
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(clip, 'f_%05d.png'), '-filter_complex', filter, '-map', '[v]',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-preset', 'slow', '-r', String(fps), out], {encoding: 'utf8'});
if (ff.status !== 0) throw Error('ffmpeg: ' + ff.stderr);

// Still: the last frame before the switch next to the frame half a second after it, each with its crop.
const still = flag('--still');
if (still) {
  const a = frames[Math.max(0, at(switchT) - 1)].file, b = frames[at(switchT + 0.5)].file;
  const z = (960 / cw).toFixed(1);
  const sf = `[0:v]split[a1][a2];[1:v]split[b1][b2];[a1]scale=960:540:flags=lanczos,${text('DLSS off (FXAA)', 16, 16, 28)}[ta];[b1]scale=960:540:flags=lanczos,${text(mode, 16, 16, 24, '#7dffa8')}[tb];` +
    `[a2]crop=${cw}:${ch}:${cx}:${cy},scale=960:540:flags=neighbor,${text(`DLSS off, ${z}x zoom`, 16, 16, 24)}[za];[b2]crop=${cw}:${ch}:${cx}:${cy},scale=960:540:flags=neighbor,${text(`DLSS on, ${z}x zoom`, 16, 16, 24, '#7dffa8')}[zb];` +
    `[ta][tb]hstack[top];[za][zb]hstack[bottom];[top][bottom]vstack[v]`;
  fs.mkdirSync(path.dirname(path.resolve(still)), {recursive: true});
  const s = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex', sf, '-map', '[v]', '-frames:v', '1', path.resolve(still)], {encoding: 'utf8'});
  if (s.status !== 0) throw Error('ffmpeg still: ' + s.stderr);
}
console.log(JSON.stringify({game, res, mode, switchSeconds: switchT, frames: last - first + 1, out, still: still ? path.resolve(still) : null}));
