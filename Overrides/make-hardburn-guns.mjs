#!/usr/bin/env node
// Adds Hard Burn's Pixal3D guns to Overrides/hardburn.sources.json: one source per part of each gun the game has a copy
// of (public/models/guns/pixal/<gun>.glb) whose original is on disk (the "source" in the copy's report, <gun>.json).
// Each part is cut from the original in the copy's frame (Tools/fidelity/split-gun.mjs) and drawn in place of the copy's
// mesh in that part, so the game's turret turning, elevation and recoil move it. The game paints a gun in the colour of
// the hull under it (scene/gun-models.js), falling back to its faction's tint (HULL_TINT); the "gunTint" variants give
// each faction's hulls (userData.glbKey on the hull) that tint, and the gun's own rule draws it untinted elsewhere.
// Gun sources already in the file are replaced; everything else stays.
//   node Overrides/make-hardburn-guns.mjs [<the game's gun export, GUNS-FOR-UNREAL.txt> [<its mounts.json>]]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = 'C:/Users/Aidan Anderson/falling-frontier-clone';
const guns = repo + '/public/models/guns/pixal';
const file = path.join(here, 'hardburn.sources.json');
const list = JSON.parse(fs.readFileSync(file, 'utf8'));
// The game's faction tints, read from its own source so they stay the same.
const tints = Function('return ' + /const HULL_TINT=(\{[^;]*\});/.exec(fs.readFileSync(repo + '/src/scene/gun-models.js', 'utf8'))[1])();
// gun-models.js hullTint: the faction is the word after "concept_" in the hull's key, or else its first word.
// A faction whose tint is already in the file keeps it (those are measured from the baked hull paint).
const kept = new Map((list.variants?.gunTint ?? []).map(v => [v.name, v]));
list.variants = {...list.variants, gunTint: Object.entries(tints).map(([faction, tint]) => kept.get(faction) ?? ({name: faction,
  match: {userData: {glbKey: [`concept_${faction}_*`, `${faction}_*`, `${faction}-*`]}}, params: {Tint: tint}}))};

// The parts of a game copy: each mesh node under "pitch", "yaw" or neither (base), as split-gun.mjs reads them, and the
// part's largest mesh, whose frame the cut part is written in and whose place it takes.
function parts(glb) {
  const b = fs.readFileSync(glb), j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  const parent = new Map(); j.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent.set(c, i)));
  const out = new Map();
  j.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    let part = 'base';
    for (let k = i; k !== undefined; k = parent.get(k)) { if (j.nodes[k].name === 'pitch') { part = 'pitch'; break; } if (j.nodes[k].name === 'yaw') { part = 'yaw'; break; } }
    const vertices = j.meshes[n.mesh].primitives.reduce((s, p) => s + j.accessors[p.attributes.POSITION].count, 0);
    if (!out.has(part) || vertices > out.get(part).vertices) out.set(part, {mesh: n.name, vertices});
  });
  return out;
}

// The game's gun export (tools/guns-for-unreal.mjs) lists each copy with its original:
//   "<part>  public/models/guns/pixal/<gun>.glb  (turret)  original: <file>"
const exportFile = process.argv[2] ?? 'G:/JsGameBridge-fidelity-order/GUNS-FOR-UNREAL.txt', exported = new Map();
if (fs.existsSync(exportFile)) for (const m of fs.readFileSync(exportFile, 'utf8').matchAll(/guns\/pixal\/([a-z0-9-]+)\.glb\s+\(\w+\)\s+original:\s*(\S.*?\.glb)/g)) exported.set(m[1], m[2].replaceAll('\\', '/'));

// The game's mount export (mounts.json "models") lists the gun files its ships carry; with it, only those guns.
const mountsFile = process.argv[3] ?? 'G:/JsGameBridge-fidelity-order/mounts.json';
const fitted = fs.existsSync(mountsFile) ? new Set((JSON.parse(fs.readFileSync(mountsFile, 'utf8')).models ?? []).map(m => path.basename(m, '.glb'))) : new Set();

const sources = [];
for (const report of fs.readdirSync(guns).filter(f => f.endsWith('.json') && f !== 'manifest.json').sort()) {
  const id = report.replace(/\.json$/, ''), copy = `${guns}/${id}.glb`;
  if (fitted.size && !fitted.has(id)) continue;
  // The original: the one the game's gun export names for this copy, or else the asset vault's file for the gun.
  const vault = `F:/AssetVault/hard-burn/assets/gun-${id}/originals/pixal3d_textured.glb`;
  const original = exported.get(id) ?? (fs.existsSync(vault) ? vault : null);
  if (!original || !fs.existsSync(original) || !fs.existsSync(copy)) { console.log(`no original for ${id}`); continue; }
  for (const [part, {mesh}] of parts(copy)) {
    sources.push({name: `gun_${id.replaceAll('-', '_')}_${part}`, kind: 'gun', source: original, split: {copy, part},
      // "<mesh>*" also takes the far model's mesh (<mesh>-far), which the game swaps in with distance.
      match: {mesh: mesh.replace(/-far$/, '') + '*', userData: {gunModel: `pixal/${id}`}}, fit: 'bounds', check: copy,
      keys: [`/models/guns/pixal/${id}.glb`], variants: 'gunTint', params: {EnvIntensity: 0.25, PaintedHull: 1.3}, bake: {flatten: 0.75}});
  }
}
list.sources = [...list.sources.filter(s => s.kind !== 'gun'), ...sources];
fs.writeFileSync(file, JSON.stringify(list, null, 1) + '\n');
console.log(`${sources.length} gun parts from ${new Set(sources.map(s => s.source)).size} guns, tinted for ${list.variants.gunTint.length} factions`);
