#!/usr/bin/env node
// Brings the livery textures Tools/fidelity/bake-livery.mjs painted into the host project jsgb.local.json names
// (Tools/fidelity/import_livery.py), and clears the hand-made colour adjustments in the overrides file that the
// livery now replaces (Tint, LiveryWeight, PaintedHull).
//   node Tools/fidelity/import-livery.mjs <overrides.json> <bake dir> [--root /Game/Fidelity/HardBurn]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {settings} from '../jsgb.mjs';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [rulesFile, bakeDir, ...rest] = process.argv.slice(2);
const root = rest.includes('--root') ? rest[rest.indexOf('--root') + 1] : '/Game/Fidelity/HardBurn';
const baked = JSON.parse(fs.readFileSync(path.join(bakeDir, 'bake.json'), 'utf8'));
const hulls = Object.entries(baked).filter(([, b]) => !b.error).map(([name]) => ({name, png: path.resolve(bakeDir, name + '.png')})).filter(h => fs.existsSync(h.png));
const jobs = path.resolve(bakeDir, 'import-jobs.json'), report = path.resolve(bakeDir, 'import-report.json');
fs.writeFileSync(jobs, JSON.stringify({root, report, hulls}, null, 1));
// One Unreal at a time on this PC (Tools/run-unreal.mjs): wait for the slot.
const busy = () => execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {encoding: 'utf8'}).split(/\r?\n/).some(l => /^"Unreal(Editor|Editor-Cmd|Game)?[^"]*\.exe"/i.test(l) && !/TraceServer|CrashReport/i.test(l));
for (const start = Date.now(); busy();) {
  if (Date.now() - start > 3600e3) throw Error('Unreal slot still busy after an hour');
  console.log('waiting for the Unreal slot'); await new Promise(r => setTimeout(r, 15000));
}
console.log(`importing ${hulls.length} livery textures`);
const r = spawnSync(path.join(path.dirname(settings().engine), 'UnrealEditor-Cmd.exe'), [settings().project, '-run=pythonscript',
  `-script=${path.join(bridge, 'Tools/fidelity/import_livery.py')}`, '-unattended', '-nosplash', '-nopause', '-stdout'],
  {env: {...process.env, JSGB_LIVERY_JOBS: jobs}, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 7200e3});
fs.writeFileSync(path.resolve(bakeDir, 'import.log'), (r.stdout ?? '') + (r.stderr ?? ''));
const result = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : {done: [], failed: {all: `no report (exit ${r.status})`}};
// The livery replaces the hand-made colour adjustments.
const doc = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
for (const rule of doc.overrides) if (result.done.includes(rule.name) && rule.params) {
  for (const k of ['Tint', 'LiveryWeight', 'PaintedHull']) delete rule.params[k];
  if (!Object.keys(rule.params).length) delete rule.params;
}
fs.writeFileSync(rulesFile, JSON.stringify(doc, null, 1) + '\n');
console.log(`${result.done.length} hulls painted, ${Object.keys(result.failed).length} failed${Object.keys(result.failed).length ? ': ' + Object.keys(result.failed).join(', ') : ''}`);
process.exit(Object.keys(result.failed).length ? 1 : 0);
