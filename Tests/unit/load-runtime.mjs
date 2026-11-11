// Loads a runtime TypeScript module as a fresh copy for one test. Modules such as overrides.ts keep what they work out
// in module variables, so each scenario gets its own copy. The copy and the test share one three.js, which the
// runtime reaches as 'three-real', and host.ts finds the stub host the test passes in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modules = path.join(root, 'Runtime/node_modules');
const threeUrl = pathToFileURL(path.join(modules, 'three/build/three.core.js')).href;
const esbuild = await import(pathToFileURL(path.join(modules, 'esbuild/lib/main.js')).href);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jsgb-unit-runtime-'));
process.on('exit', () => fs.rmSync(out, {recursive: true, force: true}));

export const THREE = await import(threeUrl);

let count = 0;
/** A new copy of Runtime/src/<file>, with globalThis.__jsgbHost set to host while it loads. three: another three.js
 *  build for 'three-real' (moduleThreeUrl has the shader chunks and ShaderLib, which three.core.js leaves out). */
export const moduleThreeUrl = pathToFileURL(path.join(modules, 'three/build/three.module.js')).href;
export async function loadRuntime(file, host = {log() {}, registry: ''}, three = threeUrl) {
  const outfile = path.join(out, `module-${++count}.mjs`);
  await esbuild.build({entryPoints: [path.join(root, 'Runtime/src', file)], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning',
    plugins: [{name: 'three-real', setup(b) { b.onResolve({filter: /^three-real$/}, () => ({path: three, external: true})); }}]});
  globalThis.__jsgbHost = host;
  return import(pathToFileURL(outfile).href);
}
