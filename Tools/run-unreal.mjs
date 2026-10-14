#!/usr/bin/env node
// Starts Unreal on the JsGameBridge test host with a built game, once no other Unreal process runs.
//   node Tools/run-unreal.mjs <game> [--offscreen] [--res 1920x1080] [--script file] [--capture dir]
//        [--capture-fps 30] [--fixed-fps 30] [--frames N] [--search ?x] [--fresh] [--timeout 900]
//        [--project path/to/Host.uproject] [--no-ui] [--detach] [--inspect port]
//        [--dlss dlaa|quality|balanced|performance|ultra] [--tsr percent] [--frame-gen] [--vibrance 0..1] [--hud]
//        [--lumen] [--lumen-preset high|light] [--no-overrides] [--js-thread] [--js-hz 60]
// The engine and host project come from jsgb.local.json or JSGB_ENGINE / JSGB_PROJECT.
// Prints the host's /bridge/status once the game is ready. Without --detach it waits for Unreal to
// exit (use --frames or a script `quit` step) and kills it when --timeout seconds pass.
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync, execFileSync} from 'node:child_process';
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

// --js-thread needs Puerts built thread-safe (Patches/puerts-thread-safe.patch). The first run with the flag applies the
// patch to the host project's Puerts and builds the editor once, so the flag is all a developer passes.
function threadSafePuerts() {
  const plugins = path.join(path.dirname(project), 'Plugins');
  const puerts = ['Puerts', 'puerts'].map(n => path.join(plugins, n)).find(d => fs.existsSync(path.join(d, 'Source/JsEnv/JsEnv.Build.cs')));
  if (!puerts) { console.log(`--js-thread: no Puerts plugin in ${plugins}, so the JavaScript stays on the game thread`); return; }
  const patch = path.join(bridge, 'Patches/puerts-thread-safe.patch');
  const apply = (...a) => spawnSync('git', ['apply', '--ignore-whitespace', ...a, patch], {cwd: puerts, encoding: 'utf8'});
  const stamp = path.join(puerts, 'Intermediate', 'jsgb-thread-safe.txt');
  if (apply('--reverse', '--check').status !== 0) {
    const r = apply();
    if (r.status !== 0) { console.log(`--js-thread: Patches/puerts-thread-safe.patch doesn't apply to ${puerts}, so the JavaScript stays on the game thread
${r.stderr.trim()}`); return; }
    console.log(`--js-thread: applied Patches/puerts-thread-safe.patch to ${puerts}`);
    fs.rmSync(stamp, {force: true});
  }
  if (fs.existsSync(stamp)) return;
  // Puerts and the bridge (which checks THREAD_SAFE when it compiles) are built once with the patch.
  const name = path.basename(project, '.uproject');
  const target = fs.existsSync(path.join(path.dirname(project), 'Source', `${name}Editor.Target.cs`)) ? `${name}Editor` : 'UnrealEditor';
  const buildBat = path.resolve(path.dirname(engine), '../../Build/BatchFiles/Build.bat');
  console.log(`--js-thread: building ${target} with the thread-safe Puerts (once, a few minutes)`);
  const b = spawnSync('cmd', ['/c', buildBat, target, 'Win64', 'Development', `-Project=${project}`, '-WaitMutex'], {stdio: 'inherit'});
  if (b.status !== 0) throw Error(`--js-thread: the editor build failed (exit ${b.status}); see the output above`);
  fs.mkdirSync(path.dirname(stamp), {recursive: true});
  fs.writeFileSync(stamp, `${new Date().toISOString()} built ${target} with Patches/puerts-thread-safe.patch
`);
}
if (has('--js-thread')) threadSafePuerts();

const log = `jsgb-${game.id}.log`;
const args = [project, '/Engine/Maps/Entry?game=/Script/JsGameBridge.JsgbGameMode', '-game', '-windowed', `-ResX=${resX}`, `-ResY=${resY}`,
  `-JsgbGame=${game.out}`, `-JsgbPort=${port}`, '-JsgbAllowRemote', '-nosplash', '-unattended', `-log=${log}`, `-JsgbMaxSeconds=${timeout / 1000}`];
// A game run never uses Unreal's Python plugin (an editor plugin), whose start-up scripts and garbage collection
// cost 15 to 20 ms frames during play.
args.push('-DisablePython');
// Off screen, the window may be larger than the desktop.
if (has('--offscreen')) args.push('-RenderOffScreen', '-ForceRes');
if (has('--no-ui')) args.push('-JsgbNoUI');
// Upscaling: --dlss dlaa|quality|balanced|performance|ultra, --tsr <percent>, --frame-gen, --vibrance <0..1>, --hud (FPS readout).
if (has('--frame-gen')) args.push('-JsgbFrameGen');
if (has('--hud')) args.push('-JsgbHud');
// --js-thread runs the game's JavaScript on its own thread (Puerts built with THREAD_SAFE); --js-hz caps its frame rate.
if (has('--js-thread')) args.push('-JsgbJsThread');
if (has('--no-post')) args.push('-JsgbNoPost');
if (has('--fresh')) args.push('-JsgbFresh');
// Fidelity: --lumen (Unreal's own lighting; --lumen-preset light for the cheaper one), --no-overrides (draw the game's own models).
if (flag('--lumen-preset')) args.push(`-JsgbLumen=${flag('--lumen-preset')}`); else if (has('--lumen')) args.push('-JsgbLumen');
if (has('--no-overrides')) args.push('-JsgbOverrides=0');
if (has('--mute')) args.push('-JsgbVolume=0');
if (has('--trace')) args.push('-JsgbTraceMirror');
// --ue "<args>": extra Unreal command-line arguments, e.g. --ue "-ExecCmds=r.AntiAliasingMethod 1".
if (flag('--ue')) args.push(...flag('--ue').match(/(?:[^\s"]+|"[^"]*")+/g).map(a => a.replace(/"/g, '')));
for (const [option, name] of [['--script', 'JsgbScript'], ['--capture', 'JsgbCapture'], ['--capture-fps', 'JsgbCaptureFps'], ['--fixed-fps', 'JsgbFixedFps'], ['--frames', 'JsgbFrames'], ['--search', 'JsgbSearch'], ['--seed', 'JsgbSeed'], ['--inspect', 'JsgbInspect'], ['--dlss', 'JsgbDLSS'], ['--tsr', 'JsgbTSR'], ['--vibrance', 'JsgbVibrance'], ['--dlss-preset', 'JsgbDLSSPreset'], ['--js-hz', 'JsgbJsHz']]) {
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
