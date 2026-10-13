// Cuts every gun in the sources file that has no split yet, or whose game copy is newer than its split.
import fs from 'node:fs'; import path from 'node:path'; import {execFileSync} from 'node:child_process';
const list = JSON.parse(fs.readFileSync('F:/JsgbFidelity/Overrides/hardburn.sources.json', 'utf8')), root = 'H:/builds/JsgbFidelity/guns';
let done = 0, failed = 0; const t0 = Date.now();
for (const s of list.sources.filter(s => s.split)) {
  const dir = path.join(root, path.basename(s.split.copy, '.glb')), report = path.join(dir, 'split.json');
  if (fs.existsSync(report) && fs.statSync(report).mtimeMs > fs.statSync(s.split.copy).mtimeMs) continue;
  fs.rmSync(dir, {recursive: true, force: true});
  const t = Date.now();
  try { execFileSync(process.execPath, ['F:/JsgbFidelity/Tools/fidelity/split-gun.mjs', s.source, s.split.copy, dir, '--modules', list.modules], {stdio: 'ignore'});
    const r = JSON.parse(fs.readFileSync(report, 'utf8')); done++;
    console.log(`${s.name}: ${Object.keys(r.parts).join(',')} gap ${(r.gap.mean * 100).toFixed(2)}% pitch ${r.pitch ?? r.pitchDegrees ?? '?'} in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  } catch (e) { failed++; console.log(`${s.name}: FAILED ${String(e.message).slice(0, 200)}`); }
}
console.log(`split ${done}, failed ${failed}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
