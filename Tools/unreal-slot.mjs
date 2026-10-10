#!/usr/bin/env node
// Runs one Unreal command once no other Unreal process is running (one Unreal at a time).
//   node Tools/unreal-slot.mjs [--timeout 900] -- <exe> <args...>
import {spawnSync, execFileSync} from 'node:child_process';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const options = argv.slice(0, split), command = argv.slice(split + 1);
const timeout = +(options[options.indexOf('--timeout') + 1] ?? 900) * 1000 || 900000;
const busy = () => {
  try {
    return execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {encoding: 'utf8'}).split(/\r?\n/).map(l => l.split('","')[0]?.replace(/^"/, ''))
      .filter(n => /^Unreal(Editor|Editor-Cmd|Game)?.*\.exe$/i.test(n ?? '') && !/TraceServer|CrashReport/i.test(n));
  } catch { return []; }
};
for (let b = busy(); b.length; b = busy()) { console.log(`waiting for the Unreal slot (${b.join(', ')})`); await new Promise(r => setTimeout(r, 15000)); }
const r = spawnSync(command[0], command.slice(1), {stdio: 'inherit', timeout});
process.exit(r.status ?? 1);
