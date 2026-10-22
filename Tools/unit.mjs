#!/usr/bin/env node
// Runs the unit tests in Tests/unit with Node's test runner. Tests import the runtime's TypeScript directly, so each
// one is bundled with esbuild first.
//   node Tools/unit.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = await import(pathToFileURL(path.join(bridge, 'Runtime/node_modules/esbuild/lib/main.js')).href);
const dir = path.join(bridge, 'Tests/unit');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jsgb-unit-'));
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs'));
for (const f of files) {
  // Bundled next to the source's own folder, so import.meta.url paths in a test still resolve.
  await esbuild.build({entryPoints: [path.join(dir, f)], outfile: path.join(dir, `.bundle-${f}`), bundle: true, format: 'esm', platform: 'node',
    alias: {'three-real': 'three'}, nodePaths: [path.join(bridge, 'Runtime/node_modules')], logLevel: 'warning'});
}
const r = spawnSync(process.execPath, ['--test', ...files.map(f => path.join(dir, `.bundle-${f}`))], {stdio: 'inherit'});
for (const f of files) fs.rmSync(path.join(dir, `.bundle-${f}`), {force: true});
fs.rmSync(out, {recursive: true, force: true});
process.exit(r.status ?? 1);
