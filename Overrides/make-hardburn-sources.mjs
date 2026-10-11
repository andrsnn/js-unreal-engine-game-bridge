#!/usr/bin/env node
// Writes Overrides/hardburn.sources.json from Hard Burn's model manifest: every ship and station model the game
// loads, mapped to its original Pixal3D source (full triangles, 4096 maps) and to the symmetry repair the game
// adopted for it (manifest symmetryFix: a sol-xhigh or receipts-high receipt in G:/hb-sol3d/symfix).
// Planets, the shared sphere and hand-written rules already in the file are kept.
//   node Overrides/make-hardburn-sources.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const game = 'C:/Users/Aidan Anderson/falling-frontier-clone/public';
const originals = ['C:/AI/spark-mesh-backup/outputs/falling-frontier', 'G:/pixal-work/outputs/falling-frontier'];
const symfix = 'G:/hb-sol3d/symfix';
const manifest = JSON.parse(fs.readFileSync(game + '/models/pixal3d/manifest.json', 'utf8')).models;
const file = path.join(here, 'hardburn.sources.json');
const list = JSON.parse(fs.readFileSync(file, 'utf8'));
// The ships in the fleet battle view come first, so a partial run covers what's on screen.
const battle = ['tdf_frigate', 'tdf_destroyer', 'tdf_corvette', 'tdf_carrier', 'tdf_cruiser', 'mrn_frigate', 'mrn_destroyer', 'mrn_corvette', 'mrn_carrier', 'mrn_cruiser', 'tdf_starbase', 'mrn_starbase'].map(k => 'concept_' + k);
const models = new Map();
for (const [key, e] of Object.entries(manifest)) {
  if (!e.lods?.[0]) continue;
  const [, , , dir, hash] = e.lods[0].split('/');
  const id = dir + '/' + hash;
  if (!models.has(id)) models.set(id, {dir, hash, keys: [], fix: e.symmetryFix, lod0: game + e.lods[0], station: e.normalize === 'max'});
  models.get(id).keys.push(key);
}
// The game's hull livery (scene/hull-livery.js): each faction's paint over the source texture's relief.
const palettes = {tdf: 0x9eafb5, mrn: 0x63332f, cartel: 0x42464c, helion: 0xb7a17a, ueg: 0x6f7957, corsair: 0x3a4852, veil: 0x343150};
const linear = hex => [16, 8, 0].map(s => { const c = ((hex >> s) & 255) / 255; return +(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).toFixed(4); });
function liveryParams(dir, station) {
  const faction = /^concept-([a-z]+)-/.exec(dir)?.[1];
  const paint = palettes[faction] ?? palettes.tdf;
  return {EnvIntensity: 0.5, LiveryWeight: station ? 0 : 0.55, LiveryPaint: linear(paint), ...(station ? {MetalScale: 0.35} : {})};
}
const hulls = [];
for (const m of models.values()) {
  const source = originals.map(o => `${o}/${m.dir}/pixal3d_textured.glb`).find(f => fs.existsSync(f));
  if (!source) { console.log(`no original for ${m.dir} (${m.keys.join(', ')})`); continue; }
  let receipt;
  if (m.fix?.provider === 'sol-xhigh') receipt = `${symfix}/${m.dir}/${m.hash}/symfix-sol-xhigh.json`;
  else if (m.fix?.provider === 'receipts-high') receipt = `${symfix}/receipts-high/${m.fix.canonical ?? m.fix.key}.json`;
  if (receipt && !fs.existsSync(receipt)) { console.log(`missing receipt ${receipt}`); receipt = undefined; }
  const name = m.dir.replaceAll('-', '_');
  hulls.push({name, source, match: {url: `*/${m.dir}/${m.hash}/*`}, fit: 'bounds', check: m.lod0, ...(receipt ? {receipt} : {}),
    keys: m.keys, params: liveryParams(m.dir, m.station)});
}
const rank = h => { const i = h.keys.findIndex(k => battle.includes(k)); return i >= 0 ? battle.indexOf(h.keys[i]) : 1000; };
hulls.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
list.sources = [...hulls, ...list.sources.filter(s => s.kind)];
fs.writeFileSync(file, JSON.stringify(list, null, 1) + '\n');
console.log(`${hulls.length} hulls (${hulls.filter(h => h.receipt).length} with symmetry repairs), ${list.sources.length - hulls.length} planet sources`);
