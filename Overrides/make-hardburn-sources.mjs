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
// The exact Pixal3D output each game model was built from: AssetVault keeps originals by the SHA-256 that the
// manifest records (vaultSource.rawSHA256). Later regenerations elsewhere can differ in shape.
const vault = 'F:/AssetVault/hard-burn/assets';
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
  if (!models.has(id)) models.set(id, {dir, hash, keys: [], fix: e.symmetryFix, lod0: game + e.lods[0], station: e.normalize === 'max', raw: e.vaultSource?.rawSHA256});
  models.get(id).keys.push(key);
}
// Each model shows its own Pixal3D textures, as in its preview: no faction tint, livery or repaint (a check on the
// TDF frigate showed those were what made the hulls look worse than the originals).
const liveryParams = () => ({EnvIntensity: 0.5, PaintedHull: 0, LiveryWeight: 0});
// Hulls whose repair includes hand edits the receipt only describes in words (a rolled cargo row, a bow correction,
// cleanup regions). Tools/fidelity/check-hulls.mjs found the replayed repair off from the game's model by more than a
// few percent, so these use the game's own repaired geometry with the original's 4096 textures.
// The TDF capital left this list on 13 October: up close its 113,852 triangles read as flat facets next to the guns, and
// the replayed repair on its original (973,484 triangles) is within 2.6% of the game's hull bounds.
const gameGeometry = new Set(['concept-corsair-ore-hauler', 'concept-helion-scout', 'concept-tdf-colony-ship']);
const hulls = [];
for (const m of models.values()) {
  const source = m.raw && [`${vault}/${m.dir}/originals/${m.raw}/pixal3d_textured.glb`].find(f => fs.existsSync(f));
  if (!source) { console.log(`no original for ${m.dir} (${m.keys.join(', ')})`); continue; }
  let receipt;
  if (m.fix?.provider === 'sol-xhigh') receipt = `${symfix}/${m.dir}/${m.hash}/symfix-sol-xhigh.json`;
  else if (m.fix?.provider === 'receipts-high') receipt = `${symfix}/receipts-high/${m.fix.canonical ?? m.fix.key}.json`;
  if (receipt && !fs.existsSync(receipt)) { console.log(`missing receipt ${receipt}`); receipt = undefined; }
  const name = m.dir.replaceAll('-', '_');
  // The game's models keep the source's own frame, so the original lines up with no fitting (Tools/fidelity/check-hulls.mjs).
  hulls.push({name, source, match: {url: `*/${m.dir}/${m.hash}/*`}, fit: 'none', check: m.lod0, ...(receipt ? {receipt} : {}), ...(gameGeometry.has(m.dir) ? {geometryFrom: m.lod0} : {}),
    keys: m.keys, params: liveryParams(m.dir, m.station)});
}
const rank = h => { const i = h.keys.findIndex(k => battle.includes(k)); return i >= 0 ? battle.indexOf(h.keys[i]) : 1000; };
hulls.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

list.sources = [...hulls, ...list.sources.filter(s => s.kind)];
fs.writeFileSync(file, JSON.stringify(list, null, 1) + '\n');
console.log(`${hulls.length} hulls (${hulls.filter(h => h.receipt).length} with symmetry repairs), ${list.sources.length - hulls.length} planet sources`);
