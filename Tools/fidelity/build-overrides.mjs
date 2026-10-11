#!/usr/bin/env node
// Builds a game's overrides.json from a list of high-resolution glTF sources: prepares each source
// (PNG textures, bounds), imports them into the host project as Nanite meshes with PBR materials, and
// writes one override rule per source.
//   node Tools/fidelity/build-overrides.mjs <sources.json> <overrides.json> [--work dir] [--only name,name] [--skip-import]
//        [--rebuild-master] [--materials-only]
// sources.json: {"root": "/Game/Fidelity/<Game>", "modules": "<node_modules with @gltf-transform, sharp>",
//   "sources": [{"name", "source": "<file.glb>", "match": {...}, "fit": "bounds", "params": {...}, "check": "<game's own glb>"}]}
// "check" names the model the game draws; its bounds are compared with the source's, and a mismatch
// (another shape or orientation) is reported.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const {settings} = await import(pathToFileURL(path.join(bridge, 'Tools/jsgb.mjs')).href);
const [listFile, outFile, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
if (!listFile || !outFile) { console.error('usage: build-overrides.mjs <sources.json> <overrides.json> [--work dir] [--only a,b] [--skip-import]'); process.exit(2); }
const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const work = path.resolve(flag('--work', path.join(path.dirname(settings().project), 'FidelityWork')));
const only = flag('--only')?.split(',');
const sources = list.sources.filter(s => !only || only.includes(s.name));

// Bounds of a glb's POSITION accessors (node transforms ignored: the game's models and sources keep identity nodes).
function glbBounds(file) {
  const fd = fs.openSync(file, 'r'), head = Buffer.alloc(20); fs.readSync(fd, head, 0, 20, 0);
  const json = Buffer.alloc(head.readUInt32LE(12)); fs.readSync(fd, json, 0, json.length, 20); fs.closeSync(fd);
  const j = JSON.parse(json.toString()), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of j.meshes ?? []) for (const p of m.primitives) {
    const a = j.accessors[p.attributes.POSITION];
    if (a?.min) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i]); max[i] = Math.max(max[i], a.max[i]); }
  }
  return [min, max];
}
const extent = b => b[1].map((v, i) => v - b[0][i]);

const prepared = [];
for (const s of sources) {
  const dir = path.join(work, 'prep', s.name), info = path.join(dir, s.name + '.json');
  if (!fs.existsSync(info) || fs.statSync(info).mtimeMs < fs.statSync(s.source).mtimeMs) {
    execFileSync(process.execPath, [path.join(bridge, 'Tools/fidelity/prepare-glb.mjs'), s.source, dir, s.name, '--modules', list.modules], {stdio: ['ignore', 'ignore', 'inherit']});
  }
  const p = JSON.parse(fs.readFileSync(info, 'utf8'));
  if (s.check && fs.existsSync(s.check)) {
    const a = extent(p.bounds), b = extent(glbBounds(s.check)), ra = a.map(x => x / Math.max(...a)), rb = b.map(x => x / Math.max(...b));
    const off = Math.max(...ra.map((x, i) => Math.abs(x - rb[i])));
    console.log(`${s.name}: source ${a.map(x => x.toFixed(3)).join(' x ')}, game model ${b.map(x => x.toFixed(3)).join(' x ')}${off > 0.08 ? '  << proportions differ by ' + (off * 100).toFixed(0) + '%' : ''}`);
  }
  prepared.push({...p, rule: s});
}

const resultFile = path.join(work, 'import-jobs.json.result.json');
if (!rest.includes('--skip-import')) {
  const jobs = path.join(work, 'import-jobs.json');
  // The studio environment the hull material reflects (Tools/fidelity/studio_env.py).
  const studio = path.join(work, 'env', 'HDR_JsgbStudio.hdr');
  fs.mkdirSync(path.dirname(studio), {recursive: true});
  execFileSync('python', [path.join(bridge, 'Tools/fidelity/studio_env.py'), studio], {stdio: 'ignore'});
  // --materials-only: keep the imported meshes and textures, rebuild the materials (with --rebuild-master).
  fs.writeFileSync(jobs, JSON.stringify({root: list.root, studio, maxTexture: list.maxTexture ?? 0, rebuildMaster: rest.includes('--rebuild-master'),
    materialsOnly: rest.includes('--materials-only'), assets: prepared.map(({rule, ...p}) => p)}, null, 1));
  // One Unreal at a time on this PC (Tools/run-unreal.mjs): wait for the slot.
  const busy = () => execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {encoding: 'utf8'}).split(/\r?\n/).some(l => /^"Unreal(Editor|Editor-Cmd|Game)?[^"]*\.exe"/i.test(l) && !/TraceServer|CrashReport/i.test(l));
  for (const start = Date.now(); busy();) {
    if (Date.now() - start > 3600e3) throw Error('Unreal slot still busy after an hour');
    console.log('waiting for the Unreal slot'); await new Promise(r => setTimeout(r, 15000));
  }
  const cmd = path.join(path.dirname(settings().engine), 'UnrealEditor-Cmd.exe');
  console.log(`importing ${prepared.length} models into ${list.root}`);
  const r = spawnSync(cmd, [settings().project, '-run=pythonscript', `-script=${path.join(bridge, 'Tools/fidelity/import_assets.py')}`, '-unattended', '-nosplash', '-nopause', '-stdout'],
    {env: {...process.env, JSGB_FIDELITY_JOBS: jobs}, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 3600e3});
  fs.writeFileSync(path.join(work, 'import.log'), (r.stdout ?? '') + (r.stderr ?? ''));
  if (r.status !== 0) throw Error(`import failed (exit ${r.status}); see ${path.join(work, 'import.log')}`);
}
const results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
const old = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')).overrides ?? [] : [];
const rules = new Map(old.map(r => [r.name, r]));
for (const p of prepared) {
  const res = results.find(x => x.name === p.name);
  if (!res?.mesh) { console.log(`${p.name}: not imported (${res?.error ?? 'no result'})`); continue; }
  const {name, match, fit = 'bounds', params, others} = p.rule;
  rules.set(name, {name, match, mesh: res.mesh, fit, bounds: p.bounds, ...(params ? {params} : {}), ...(others ? {others} : {}),
    source: p.source.replaceAll('\\', '/'), triangles: Math.round(p.triangles), textures: Object.fromEntries(Object.entries(p.textures).map(([k, t]) => [k, `${t.width}x${t.height}`]))});
}
fs.writeFileSync(outFile, JSON.stringify({version: 1, overrides: [...rules.values()]}, null, 1) + '\n');
console.log(`wrote ${rules.size} rules to ${outFile}`);
