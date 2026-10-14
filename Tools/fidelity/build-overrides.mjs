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
// "split": {"copy": "<game's gun glb>", "part": "yaw"}: one part of a gun, cut from the original in the game copy's frame
// (Tools/fidelity/split-gun.mjs). "variants": the name of a list in sources.json "variants"; each entry adds a rule
// "<name>_<entry name>" before the source's own, with the entry's match and params added to the source's (a gun's tint
// on each faction's hulls).
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
  // A generated mesh ("generate": "sphere"), shared by rules that name it in "mesh".
  if (s.kind === 'mesh') {
    const glb = path.join(dir, s.name + '.glb');
    if (!fs.existsSync(glb)) { fs.mkdirSync(dir, {recursive: true}); execFileSync(process.execPath, [path.join(bridge, 'Tools/fidelity/make-sphere.mjs'), glb, '--modules', list.modules, '--segments', String(s.segments ?? 512)], {stdio: 'ignore'}); }
    prepared.push({name: s.name, kind: 'mesh', glb, bounds: [[-1, -1, -1], [1, 1, 1]], source: glb, textures: {}, rule: s});
    continue;
  }
  // A planet: its colour map, and a normal map from it for rocky bodies (Tools/fidelity/planet_maps.py).
  if (s.kind === 'planet') {
    if (!fs.existsSync(info) || fs.statSync(info).mtimeMs < fs.statSync(s.source).mtimeMs) {
      execFileSync('python', [path.join(bridge, 'Tools/fidelity/planet_maps.py'), s.source, dir, s.name, '--relief', String(s.relief ?? 0), '--scale', String(s.scale ?? 1)], {stdio: 'ignore'});
    }
    prepared.push({...JSON.parse(fs.readFileSync(info, 'utf8')), rule: s});
    continue;
  }
  // "receipt": the symmetry repair the game adopted for its own copy, applied to the full original first.
  let input = s.source;
  // "split": a gun's part, cut from the original in the game copy's frame; every part of a gun is written at once.
  if (s.split) {
    const dir = path.join(path.dirname(work), 'guns', path.basename(s.split.copy, '.glb'));
    input = path.join(dir, s.split.part + '.glb');
    if (!fs.existsSync(input)) {
      execFileSync(process.execPath, [path.join(bridge, 'Tools/fidelity/split-gun.mjs'), s.source, s.split.copy, dir, '--modules', list.modules], {stdio: 'ignore'});
      const r = JSON.parse(fs.readFileSync(path.join(dir, 'split.json'), 'utf8'));
      console.log(`${s.name}: split into ${Object.keys(r.parts).join(', ')}, mean gap to the game's copy ${(r.gap.mean * 100).toFixed(2)}% of its size`);
    }
  // "geometryFrom": the game's own repaired model, with the original's textures (Tools/fidelity/retexture.mjs).
  } else if (s.geometryFrom) {
    input = path.join(path.dirname(work), 'hulls', s.name + '.glb');
    // Written under a temporary name and renamed when complete, so an interrupted run leaves no half-written file.
    if (!fs.existsSync(input)) { console.log(`${s.name}: game geometry ${execFileSync(process.execPath, [path.join(bridge, 'Tools/fidelity/retexture.mjs'), s.geometryFrom, s.source, input.replace(/\.glb$/, '.part.glb'), '--modules', list.modules], {encoding: 'utf8'}).trim()}`); fs.renameSync(input.replace(/\.glb$/, '.part.glb'), input); }
  } else if (s.receipt) {
    input = path.join(path.dirname(work), 'hulls', s.name + '.glb');
    if (!fs.existsSync(input)) {
      const r = execFileSync(process.execPath, [path.join(bridge, 'Tools/fidelity/symfix.mjs'), s.source, input.replace(/\.glb$/, '.part.glb'), '--receipt', s.receipt, '--modules', list.modules, ...(s.check ? ['--check', s.check] : [])], {encoding: 'utf8'});
      fs.renameSync(input.replace(/\.glb$/, '.part.glb'), input);
      console.log(`${s.name}: symmetry repair ${r.trim()}`);
    }
  }
  // "cleanup": {"strength": 0.5, "organic": "auto"}: the model's lumps and ripples taken out and its flat areas made flat
  // before the import (Tools/fidelity/pixal-cleanup/cleanup.py, run in Blender; jsgb.local.json "blender" names the
  // program). The cleaned file stays in hulls-clean/: it is the mesh Unreal draws, so the paint bake reads it too.
  if (s.cleanup) {
    const cleaned = path.join(path.dirname(work), 'hulls-clean', s.name + '.glb'), part = cleaned.replace(/\.glb$/, '.part.glb');
    if (!fs.existsSync(cleaned) || fs.statSync(cleaned).mtimeMs < fs.statSync(input).mtimeMs) {
      fs.mkdirSync(path.dirname(cleaned), {recursive: true});
      const blender = settings().blender ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
      const out = execFileSync(blender, ['--background', '--python', path.join(bridge, 'Tools/fidelity/pixal-cleanup/cleanup.py'), '--', input, part,
        '--strength', String(s.cleanup.strength ?? 0.5), '--organic', s.cleanup.organic ?? 'auto'], {encoding: 'utf8', maxBuffer: 1 << 26});
      if (!fs.existsSync(part)) throw Error(`${s.name}: the clean-up wrote nothing: ${out.slice(-400)}`);
      fs.renameSync(part, cleaned);
      const r = JSON.parse(/CLEANUP (\{.*\})/.exec(out)?.[1] ?? '{}');
      console.log(`${s.name}: cleaned, flat areas lean ${r.roughness_before_degrees} -> ${r.roughness_final_degrees} degrees, moved ${r.moved_mean_percent}% of its size on average, ${r.moved_max_percent}% at most${r.organic ? ' (organic: mostly left alone)' : ''}`);
    }
    input = cleaned;
  }
  if (!fs.existsSync(info) || fs.statSync(info).mtimeMs < fs.statSync(input).mtimeMs) {
    execFileSync(process.execPath, [path.join(bridge, 'Tools/fidelity/prepare-glb.mjs'), input, dir, s.name, '--modules', list.modules], {stdio: ['ignore', 'ignore', 'inherit']});
  }
  const p = JSON.parse(fs.readFileSync(info, 'utf8'));
  if (s.check && fs.existsSync(s.check)) {
    const a = extent(p.bounds), b = extent(glbBounds(s.check)), ra = a.map(x => x / Math.max(...a)), rb = b.map(x => x / Math.max(...b));
    const off = Math.max(...ra.map((x, i) => Math.abs(x - rb[i])));
    console.log(`${s.name}: source ${a.map(x => x.toFixed(3)).join(' x ')}, game model ${b.map(x => x.toFixed(3)).join(' x ')}${off > 0.08 ? '  << proportions differ by ' + (off * 100).toFixed(0) + '%' : ''}`);
  }
  prepared.push({...p, rule: s, input});
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
    materialsOnly: rest.includes('--materials-only'), assets: prepared.map(({rule, ...p}) => ({...p, ...(rule.maxTexture ? {maxTexture: rule.maxTexture} : {})}))}, null, 1));
  // One Unreal at a time on this PC (Tools/run-unreal.mjs): wait for the slot.
  const busy = () => execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {encoding: 'utf8'}).split(/\r?\n/).some(l => /^"Unreal(Editor|Editor-Cmd|Game)?[^"]*\.exe"/i.test(l) && !/TraceServer|CrashReport/i.test(l));
  for (const start = Date.now(); busy();) {
    if (Date.now() - start > 3600e3) throw Error('Unreal slot still busy after an hour');
    console.log('waiting for the Unreal slot'); await new Promise(r => setTimeout(r, 15000));
  }
  const cmd = path.join(path.dirname(settings().engine), 'UnrealEditor-Cmd.exe');
  console.log(`importing ${prepared.length} models into ${list.root}`);
  // A full-detail hull takes Unreal up to about 3 minutes to build, so the time limit grows with the batch: 5 minutes a
  // model, an hour at least.
  const limit = Math.max(3600e3, prepared.length * 300e3);
  const r = spawnSync(cmd, [settings().project, '-run=pythonscript', `-script=${path.join(bridge, 'Tools/fidelity/import_assets.py')}`, '-unattended', '-nosplash', '-nopause', '-stdout'],
    {env: {...process.env, JSGB_FIDELITY_JOBS: jobs}, encoding: 'utf8', maxBuffer: 1 << 28, timeout: limit});
  fs.writeFileSync(path.join(work, 'import.log'), (r.stdout ?? '') + (r.stderr ?? ''));
  if (r.status !== 0) throw Error(r.status === null ? `import stopped at its ${Math.round(limit / 60e3)} minute limit; see ${path.join(work, 'import.log')}` : `import failed (exit ${r.status}); see ${path.join(work, 'import.log')}`);
}
const results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
const before = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const old = before.overrides ?? [];
const rules = new Map(old.map(r => [r.name, r]));
// Rules written by hand (a hide rule, a material swap) go in as they are.
for (const r of list.extraRules ?? []) rules.set(r.name, r);
for (const p of prepared) {
  if (p.kind === 'mesh') continue;
  const res = results.find(x => x.name === p.name);
  // A planet draws the shared mesh it names with its own material.
  const meshSource = p.kind === 'planet' ? prepared.find(x => x.name === p.rule.mesh) : p;
  const meshPath = p.kind === 'planet' ? results.find(x => x.name === p.rule.mesh)?.mesh : res?.mesh;
  if (!meshPath || !res) { console.log(`${p.name}: not imported (${res?.error ?? 'no result'})`); continue; }
  const {name, match, fit = 'bounds', params, others, receipt, keys} = p.rule;
  // A split gun part's mesh comes from the cut file, whose uvs and frame the livery bake follows ("imported").
  const rule = {name, match, mesh: meshPath, ...(p.kind === 'planet' ? {material: res.material} : {}), fit, bounds: meshSource.bounds, ...(params ? {params} : {}), ...(others ? {others} : {}),
    source: (p.rule.source ?? p.source).replaceAll('\\', '/'), ...(p.rule.split || p.rule.cleanup ? {imported: p.input.replaceAll('\\', '/')} : {}), ...(receipt ? {symmetryRepair: receipt} : {}), ...(keys ? {keys} : {}), ...(p.rule.bake ? {bake: p.rule.bake} : {}),  ...(p.triangles ? {triangles: Math.round(p.triangles)} : {}), textures: Object.fromEntries(Object.entries(p.textures).map(([k, t]) => [k, `${t.width}x${t.height}`]))};
  // Variants come first, so a game object that matches one of them takes it, and the source's own rule catches the rest.
  const variants = (list.variants?.[p.rule.variants] ?? []).map(v => ({...rule, name: `${name}_${v.name}`, match: {...match, ...v.match, userData: {...match.userData, ...v.match?.userData}},
    params: {...params, ...v.params}, keys: undefined, imported: undefined}));
  for (const r of [...variants, rule]) { rules.delete(r.name); rules.set(r.name, r); }
}
// The effect switches ("effects") stay as they were.
fs.writeFileSync(outFile, JSON.stringify({version: 1, ...(before.effects ? {effects: before.effects} : {}), overrides: [...rules.values()]}, null, 1) + '\n');
// --clean: the prepared PNGs and repaired glTF copies are only needed for the import.
if (rest.includes('--clean')) for (const p of prepared) {
  if (!results.find(x => x.name === p.name && !x.error)) continue;
  fs.rmSync(path.join(work, 'prep', p.name), {recursive: true, force: true});
  if (p.rule.receipt || p.rule.geometryFrom) fs.rmSync(path.join(path.dirname(work), 'hulls', p.name + '.glb'), {force: true});
}
console.log(`wrote ${rules.size} rules to ${outFile}`);
