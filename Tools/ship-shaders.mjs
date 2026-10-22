// Internal package helper. Shader preparation calls this automatically.
import fs from 'node:fs';
import path from 'node:path';
export function shipShaders(store, game) {
  const out = path.join(game, 'jsgb-store');
  fs.mkdirSync(out, {recursive: true});
  const files = fs.readdirSync(store).filter(f => /^shader-[0-9a-f]{32}\.json$/.test(f));
  for (const f of files) {
    const text = fs.readFileSync(path.join(store, f), 'utf8');
    const value = JSON.parse(text);
    if (value.failed || typeof value.hlsl !== 'string') throw Error(`Shader ${f} is not ready; fix its shader error and package again.`);
    if (path.resolve(store) !== path.resolve(out)) fs.writeFileSync(path.join(out, f), text);
  }
  console.log(`${files.length} prepared shader translations in the package`);
  return files.length;
}
