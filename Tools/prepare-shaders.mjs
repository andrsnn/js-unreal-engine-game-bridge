import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {shipShaders} from './ship-shaders.mjs';
const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function prepareShaders(game) {
  if (game.page) return;
  const store = path.join(game.out, 'jsgb-store');
  if (fs.existsSync(store)) for (const f of fs.readdirSync(store)) if (/^shader-[0-9a-f]{32}\.json$/.test(f)) fs.rmSync(path.join(store, f));
  fs.rmSync(path.join(game.out, 'shader-preparation-error.txt'), {force: true});
  const nativeCoverage = {};
  const runs = game.captureScripts?.length ? game.captureScripts : [{}];
  for (let i = 0; i < runs.length; i++) {
    console.log(`Preparing shaders: view ${i + 1}/${runs.length}`);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--run', game.file, String(i)], {stdio: 'inherit'});
    if (r.status === 0) Object.assign(nativeCoverage, JSON.parse(fs.readFileSync(path.join(game.out, 'native-shader-coverage.json'), 'utf8')));
    if (r.status !== 0) {
      const errorFile = path.join(game.out, 'shader-preparation-error.txt');
      throw Error(fs.existsSync(errorFile) ? fs.readFileSync(errorFile, 'utf8') : `Shader preparation failed for ${game.id}; fix the view error above and package again.`);
    }
  }
  fs.writeFileSync(path.join(game.out, 'native-shader-coverage.json'), JSON.stringify(nativeCoverage, null, 1));
  const count = shipShaders(path.join(game.out, 'jsgb-store'), game.out);
  fs.writeFileSync(path.join(game.out, 'shader-preparation.json'), JSON.stringify({version: 1, translations: count, views: runs.map(r => r.script ?? 'initial view')}, null, 1));
}
if (process.argv[2] === '--run') {
  const {loadGame} = await import('./jsgb.mjs');
  const {smoke} = await import('./smoke.mjs');
  const game = loadGame(process.argv[3]), run = game.captureScripts?.[+process.argv[4]];
  try {
    await smoke(game, {prepareShaders: true, frames: 600, captureScript: run ? path.resolve(bridge, run.script) : undefined, search: run?.search ?? game.search ?? ''});
  } catch (e) { fs.writeFileSync(path.join(game.out, 'shader-preparation-error.txt'), e.message); console.error(e.message); process.exitCode = 1; }
}
