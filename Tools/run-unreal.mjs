#!/usr/bin/env node
// Starts Unreal on the JsGameBridge test host with a built game, once no other Unreal process runs.
//   node Tools/run-unreal.mjs <game> [--offscreen] [--res 1920x1080] [--script file] [--capture dir]
//        [--capture-fps 30] [--fixed-fps 30] [--frames N] [--search ?x] [--fresh] [--timeout 900]
//        [--project path/to/Host.uproject] [--no-ui] [--detach]
// The engine and host project come from jsgb.local.json or JSGB_ENGINE / JSGB_PROJECT.
// Prints the host's /bridge/status once the game is ready. Without --detach it waits for Unreal to
// exit (use --frames or a script `quit` step) and kills it when --timeout seconds pass.
import fs from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {loadGame, settings} = await import(pathToFileURL(path.join(bridge, 'Tools/jsgb.mjs')).href);
const [gameArg, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const has = name => rest.includes(name);
const game = loadGame(gameArg);
const engine = settings().engine;
const project = flag('--project', settings().project);
if (!engine || !project) throw Error('Set "engine" (UnrealEditor.exe) and "project" (the host .uproject) in jsgb.local.json, or JSGB_ENGINE and JSGB_PROJECT');
const port = +(flag('--port', game.reloadPort ?? 5292));
const timeout = +flag('--timeout', 900) * 1000;
const [resX, resY] = flag('--res', '1920x1080').split('x');

export function unrealProcesses() {
  try {
    return execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {encoding: 'utf8'}).split(/\r?\n/)
      .map(l => l.split('","')[0]?.replace(/^"/, '')).filter(n => /^Unreal(Editor|Editor-Cmd|Game)?.*\.exe$/i.test(n ?? '') && !/TraceServer|CrashReport/i.test(n));
  } catch { return []; }
}

// One Unreal at a time across all agents: wait for the slot.
const waitStart = Date.now();
for (let running = unrealProcesses(); running.length; running = unrealProcesses()) {
  if (Date.now() - waitStart > +flag('--slot-wait', 3600) * 1000) throw Error('Unreal slot still busy: ' + running.join(', '));
  console.log(`waiting for the Unreal slot (${running.join(', ')})`);
  await new Promise(r => setTimeout(r, 15000));
}

const log = `jsgb-${game.id}.log`;
const args = [project, '/Engine/Maps/Entry?game=/Script/JsGameBridge.JsgbGameMode', '-game', '-windowed', `-ResX=${resX}`, `-ResY=${resY}`,
  `-JsgbGame=${game.out}`, `-JsgbPort=${port}`, '-JsgbAllowRemote', '-nosplash', '-unattended', `-log=${log}`, `-JsgbMaxSeconds=${timeout / 1000}`];
if (has('--offscreen')) args.push('-RenderOffScreen');
if (has('--no-ui')) args.push('-JsgbNoUI');
if (has('--no-post')) args.push('-JsgbNoPost');
if (has('--fresh')) args.push('-JsgbFresh');
if (has('--mute')) args.push('-JsgbVolume=0');
if (has('--trace')) args.push('-JsgbTraceMirror');
// --ue "<args>": extra Unreal command-line arguments, e.g. --ue "-ExecCmds=r.AntiAliasingMethod 1".
if (flag('--ue')) args.push(...flag('--ue').match(/(?:[^\s"]+|"[^"]*")+/g).map(a => a.replace(/"/g, '')));
for (const [option, name] of [['--script', 'JsgbScript'], ['--capture', 'JsgbCapture'], ['--capture-fps', 'JsgbCaptureFps'], ['--fixed-fps', 'JsgbFixedFps'], ['--frames', 'JsgbFrames'], ['--search', 'JsgbSearch'], ['--seed', 'JsgbSeed']]) {
  const value = flag(option); if (value !== undefined) args.push(`-${name}=${/^(--script|--capture)$/.test(option) ? path.resolve(value) : value}`);
}
const started = Date.now();
const child = spawn(engine, args, {stdio: 'ignore', detached: has('--detach')});
console.log(`started Unreal pid ${child.pid}: ${game.id}, log ${path.join(path.dirname(project), 'Saved/Logs', log)}`);
let exited = false;
child.on('exit', code => { exited = true; console.log(`Unreal exited with ${code} after ${((Date.now() - started) / 1000).toFixed(0)} s`); });

let status = null;
while (!exited && Date.now() - started < timeout) {
  try { status = await (await fetch(`http://127.0.0.1:${port}/bridge/status`, {signal: AbortSignal.timeout(3000)})).json(); } catch { status = null; }
  if (status?.ready) { console.log('ready ' + JSON.stringify(status)); break; }
  await new Promise(r => setTimeout(r, 1000));
}
if (has('--detach')) { child.unref(); process.exit(status?.ready ? 0 : 1); }
while (!exited && Date.now() - started < timeout) await new Promise(r => setTimeout(r, 1000));
if (!exited) { console.log('timeout: stopping Unreal'); try { process.kill(child.pid); } catch { /* gone */ } }
const logFile = path.join(path.dirname(project), 'Saved/Logs', log);
if (fs.existsSync(logFile)) {
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
  const errors = lines.filter(l => /LogJsgb.*Error|Error: .*Jsgb|Fatal error|Assertion failed/.test(l));
  console.log(`log: ${lines.length} lines, ${errors.length} JsGameBridge errors`);
  for (const l of errors.slice(0, 20)) console.log('  ' + l.slice(0, 400));
}
