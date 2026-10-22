#!/usr/bin/env node
// Copies the shader translations a run of the game made into the game's folder, so a package ships them and players
// never translate those shaders on their own PC (each one froze the game for 0.3 to 2 s the first time).
//   node Tools/ship-shaders.mjs <host Saved/JsGameBridge/<game>/Store> <game folder, e.g. games/hardburn>
// The host reads <game folder>/jsgb-store when its own Saved store has no copy. Only translations made by the
// translator in this bridge build match (their keys name it), so run the game once with this build first. Shaders
// that can't be translated are shipped too, as markers, so they are not tried again.
import fs from 'node:fs';
import path from 'node:path';

const [store, game] = process.argv.slice(2);
if (!store || !game) { console.error('usage: node Tools/ship-shaders.mjs <Saved store folder> <game folder>'); process.exit(1); }
const out = path.join(game, 'jsgb-store');
fs.mkdirSync(out, {recursive: true});
for (const f of fs.readdirSync(out)) if (/^shader-[0-9a-f]{32}\.json$/.test(f)) fs.rmSync(path.join(out, f));
let n = 0, bytes = 0;
for (const f of fs.readdirSync(store)) {
  if (!/^shader-[0-9a-f]{32}\.json$/.test(f)) continue;
  const text = fs.readFileSync(path.join(store, f), 'utf8');
  fs.writeFileSync(path.join(out, f), text);
  n++; bytes += text.length;
}
console.log(`${n} shader translations (${(bytes / 1e6).toFixed(1)} MB) -> ${out}`);
