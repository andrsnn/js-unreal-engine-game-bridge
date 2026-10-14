#!/usr/bin/env node
// Static checks that need no Unreal and no browser: every tool and runtime script parses, every JSON file in the
// repository parses, and the runtime's TypeScript compiles to a bundle.
//   node Tools/lint.mjs
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const files = dir => fs.existsSync(path.join(bridge, dir)) ? fs.readdirSync(path.join(bridge, dir)).map(f => path.join(dir, f)) : [];

// JavaScript modules: node --check reports any syntax error.
const scripts = [...files('Tools'), ...files('JavaScript'), ...files('Tests/unit')].filter(f => /\.(mjs|cjs|js)$/.test(f));
for (const f of scripts) {
  const r = spawnSync(process.execPath, ['--check', path.join(bridge, f)], {encoding: 'utf8'});
  if (r.status !== 0) problems.push(`${f}: ${(r.stderr || '').trim().split('\n').slice(0, 4).join(' ')}`);
}

// JSON: configs, packages and the conformance results.
const json = ['package.json', 'Runtime/package.json', 'Tests/suite/package.json', 'JsGameBridge.uplugin', ...files('Games')].filter(f => /\.(json|uplugin)$/.test(f));
for (const f of json) {
  if (!fs.existsSync(path.join(bridge, f))) continue;
  try { JSON.parse(fs.readFileSync(path.join(bridge, f), 'utf8')); } catch (e) { problems.push(`${f}: ${e.message}`); }
}

// The runtime: esbuild compiles every TypeScript file through the entry point (it fails on syntax and import errors).
const esbuild = await import(pathToFileURL(path.join(bridge, 'Runtime/node_modules/esbuild/lib/main.js')).href);
for (const entry of ['Runtime/src/entry.ts', 'Runtime/src/workerRuntime.ts']) {
  try {
    await esbuild.build({entryPoints: [path.join(bridge, entry)], bundle: true, write: false, platform: 'neutral', format: 'esm', logLevel: 'silent',
      mainFields: ['module', 'main'], nodePaths: [path.join(bridge, 'Runtime/node_modules')],
      external: ['jsgb:game', 'jsgb:adapters', 'three', 'three-real', 'three/webgpu', 'fs', 'path', 'crypto', 'url', 'module', 'worker_threads'],
      define: {__JSGB_PAGE__: '{}', __JSGB_INLINE__: '""', __JSGB_WEBGL_MODULE_DRAWS__: '0', 'import.meta.env': '{}'}});
  } catch (e) { problems.push(`${entry}: ${(e.errors ?? []).map(x => x.text).join('; ') || e.message}`); }
}

console.log(`${scripts.length} scripts, ${json.length} JSON files and the runtime checked`);
for (const p of problems) console.log(`problem: ${p}`);
process.exit(problems.length ? 1 : 0);
