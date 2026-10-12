#!/usr/bin/env node
// Authors Lumen mode's Niagara effects (Tools/fidelity/author_lumen_vfx.py) into the host project jsgb.local.json names,
// under /Game/Fidelity/VFX, beside the override models. The project needs the CascadeToNiagaraConverter plugin.
//   node Tools/fidelity/author-lumen-vfx.mjs [--report <file>]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {settings} from '../jsgb.mjs';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const report = path.resolve(args.includes('--report') ? args[args.indexOf('--report') + 1] : path.join(path.dirname(settings().project), 'Saved/lumen-vfx.json'));
// One Unreal at a time on this PC (Tools/run-unreal.mjs): wait for the slot.
const busy = () => execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {encoding: 'utf8'}).split(/\r?\n/).some(l => /^"Unreal(Editor|Editor-Cmd|Game)?[^"]*\.exe"/i.test(l) && !/TraceServer|CrashReport/i.test(l));
for (const start = Date.now(); busy();) {
  if (Date.now() - start > 3600e3) throw Error('Unreal slot still busy after an hour');
  console.log('waiting for the Unreal slot'); await new Promise(r => setTimeout(r, 15000));
}
// A full editor, off screen: the Niagara converter needs Slate, which a commandlet doesn't start.
const cmd = settings().engine;
fs.rmSync(report, {force: true});
const r = spawnSync(cmd, [settings().project, `-ExecutePythonScript=${path.join(bridge, 'Tools/fidelity/author_lumen_vfx.py')}`, '-RenderOffScreen', '-unattended', '-nosplash', '-nopause', '-stdout'],
  {env: {...process.env, JSGB_LUMEN_VFX_REPORT: report}, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 1800e3});
fs.writeFileSync(report.replace(/\.json$/, '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
const result = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : {ok: false, error: `no report (exit ${r.status})`};
console.log(result.ok ? `authored ${result.assets.join(', ')}` : `authoring failed: ${result.error}`);
process.exit(result.ok ? 0 : 1);
