// node battle-report.mjs <host log>: frame rate, stalls, missing materials and Lumen switches of a scripted packaged run,
// counted from the moment the game's startup screen went away.
import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'latin1').split(/\r?\n/);
const at = l => { const m = /^\[(\d+)\.(\d+)\.(\d+)-(\d+)\.(\d+)\.(\d+):(\d+)\]/.exec(l); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null; };
const open = lines.findIndex(l => /LogJsgbHost: Display: Game /.test(l)), gone = lines.findIndex(l => /script gone #startup: done/.test(l));
if (gone < 0) { console.log('the startup screen never went away'); process.exit(1); }
const t0 = at(lines[gone]), fps = [], gpu = [], slow = [], engine = [];
let uncooked = 0, errors = 0, last = t0;
for (const l of lines.slice(gone)) {
  const t = at(l); if (t) last = t;
  let m;
  if ((m = /host frame \d+:.*frame ([\d.]+) ms, fps ([\d.]+), gpu ([\d.]+) ms.*js errors (\d+)/.exec(l))) { fps.push([(t - t0) / 1000, +m[2]]); gpu.push(+m[3]); errors = Math.max(errors, +m[4]); }
  else if ((m = /slow frame \d+: (\d+) ms/.exec(l))) slow.push([(t - t0) / 1000, +m[1]]);
  else if ((m = /engine average over \d+ frames: game thread ([\d.]+) ms, render thread ([\d.]+) ms, RHI thread ([\d.]+) ms, GPU ([\d.]+) ms/.exec(l))) engine.push(m.slice(1).map(Number));
  else if (/No cooked material/.test(l)) uncooked++;
}
const sorted = fps.map(f => f[1]).sort((a, b) => a - b), mid = a => a[Math.floor(a.length / 2)];
const worst = slow.slice().sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`loading: ${((t0 - at(lines[open])) / 1000).toFixed(0)} s from Unreal's window to the startup screen going away`);
console.log(`ran ${((last - t0) / 1000).toFixed(0)} s after that`);
console.log(`frame rate, ${fps.length} samples: lowest ${sorted[0]}, median ${mid(sorted)}, highest ${sorted.at(-1)}; samples under 60: ${sorted.filter(f => f < 60).length}`);
console.log(`GPU ms median ${mid(gpu.slice().sort((a, b) => a - b))}; engine averages (game, render, RHI, GPU ms), worst of each: ${[0, 1, 2, 3].map(i => Math.max(...engine.map(e => e[i]))).join(', ')}`);
console.log(`frames over the host's slow mark: ${slow.length}, longest ${worst.map(s => `${s[1]} ms at ${s[0].toFixed(0)} s`).join(', ') || 'none'}`);
console.log(`stalled time in slow frames: ${(slow.reduce((s, x) => s + x[1], 0) / 1000).toFixed(1)} s`);
console.log(`materials with no cooked copy: ${uncooked}; JavaScript errors: ${errors}`);
for (const l of lines.slice(gone)) if (/Lumen mode (on|off)|Loaded \d+ .*override|-> lumen|-> alive|-> \{"lumen/.test(l)) console.log('  ' + ((at(l) - t0) / 1000).toFixed(0).padStart(4) + ' s ' + l.replace(/^\[[^\]]+\]\[[^\]]+\]/, '').slice(0, 150));
