#!/usr/bin/env node
// Build a playable package with automatic shader preparation.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build, loadGame, readJson, settings} from './jsgb.mjs';
import {prepareShaders} from './prepare-shaders.mjs';
import {cookShaderPatch} from './cook-shaders.mjs';
import {prepareNativeShaders} from './prepare-native-shaders.mjs';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const has = name => args.includes(name);
if (has('--help')) { console.log('node Tools/laptop-package.mjs --games <name> [--game-config game.json] [--out folder] [--project folder] [--host] [--no-smoke]'); process.exit(0); }
const out = path.resolve(flag('--out', settings().package ?? path.join(settings().builds, 'package')));
const project = path.resolve(flag('--project', settings().packageProject ?? path.dirname(settings().project ?? 'JsgbHost.uproject')));
const log = t => console.log(`[package ${new Date().toTimeString().slice(0, 8)}] ${t}`);

const selected = flag('--games');
if (!selected) throw Error('Choose your game with --games <name>; pass --game-config <file> to use a config file.');
const games = selected.split(',');
if (flag('--game-config') && games.length !== 1) throw Error('--game-config selects one game; use --games with one game name.');
const pins = Object.fromEntries((flag('--pin', '') || '').split(',').filter(Boolean).map(p => p.split('=')));
// Windows' own tar: a GNU tar earlier on the PATH (Git's) reads "C:" in a path as a remote host.
const winTar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? path.join(process.env.SystemDrive ?? '', 'Windows'), 'System32', 'tar.exe') : 'tar';
// A game as Games/<id>.json describes it, or its pinned commit exported to <out>/../sources/<id>-<commit>, described by a
// copy of its Games/<id>.json next to it (the page build loads the game from that file).
function gameFor(id) {
  let game = loadGame(flag('--game-config', id));
  if (!pins[id]) return game;
  const commit = spawnSync('git', ['-C', game.repo, 'rev-parse', '--short=8', pins[id] + '^{commit}'], {encoding: 'utf8'}).stdout.trim();
  if (!commit) throw Error(`${id}: no commit ${pins[id]} in ${game.repo}`);
  const dir = path.join(path.dirname(out), 'sources', `${id}-${commit}`);
  if (!fs.existsSync(path.join(dir, '.jsgb-exported'))) {
    log(`${id}: exporting ${commit} to ${dir}`);
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(dir, {recursive: true});
    const tar = path.join(dir, '..', `${id}-${commit}.tar`);
    const r = spawnSync('git', ['-C', game.repo, 'archive', '--format=tar', '-o', tar, commit], {stdio: 'inherit'});
    if (r.status !== 0 || spawnSync(winTar, ['-xf', tar, '-C', dir], {stdio: 'inherit'}).status !== 0) throw Error(`${id}: exporting ${commit} failed`);
    fs.rmSync(tar);
    if (fs.existsSync(path.join(game.repo, 'node_modules'))) fs.symlinkSync(path.join(game.repo, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
    fs.writeFileSync(path.join(dir, '.jsgb-exported'), commit);
  }
  const pinned = spawnSync('git', ['-C', game.repo, 'rev-parse', commit], {encoding: 'utf8'}).stdout.trim();
  const file = `${dir}.json`;
  fs.writeFileSync(file, JSON.stringify({...readJson(path.join(bridge, 'Games', id + '.json')), id, repo: dir, out: game.out}, null, 1));
  game = loadGame(file);
  game.pinned = pinned;
  return game;
}

// robocopy /MIR copies only what changed and removes what's gone. Exit codes under 8 mean success.
function mirror(from, to) {
  const r = spawnSync('robocopy', [from, to, '/MIR', '/MT:16', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {encoding: 'utf8'});
  if (r.status >= 8) throw Error(`robocopy ${from} -> ${to} failed (${r.status}): ${r.stdout}`);
}
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(from, to); };

fs.mkdirSync(out, {recursive: true});
// Each game is built once, from its repository as it is now. The captures play that build and the package ships it, so
// the cooked materials are the ones the shipped build asks for even while the game keeps changing.
const built = {};
for (const id of games) {
  const game = gameFor(id);
  log(`building ${id} from ${game.repo}`);
  built[id] = await build(game);
  prepareShaders(game);
  if (game.pinned) { built[id].sourceCommit = game.pinned; built[id].sourceDirty = false; }
}
const hostExe = path.join(out, 'host/Windows/JsgbHost.exe');
const coverageFile = path.join(out, 'host/native-shader-coverage.json');
const priorCoverage = fs.existsSync(coverageFile) ? readJson(coverageFile) : {};
const requiredCoverage = Object.assign({}, ...games.filter(id => !built[id].page).map(id => readJson(path.join(gameFor(id).out, 'native-shader-coverage.json'))));
const changed = Object.entries(requiredCoverage).filter(([name, entry]) => priorCoverage[name]?.sha256 !== entry.sha256);
const rebuildHost = has('--host') || !fs.existsSync(hostExe) || changed.length > 0;
if (rebuildHost) {
  const captureProject = settings().project;
  if (!captureProject || !settings().engine) throw Error('Shader materials need the editor host; set engine and project in jsgb.local.json and package again.');
  const captured = path.join(path.dirname(captureProject), 'Content', 'JsgbGenerated');
  if (!has('--no-capture') && Object.keys(requiredCoverage).length) {
    // Regenerate changed shader bodies: a source key can stay the same when the translator improves.
    for (const [name] of changed) {
      if (!/^M_[a-zA-Z0-9_]+$/.test(name)) throw Error('Invalid shader material name.');
      fs.rmSync(path.join(captured, name + '.uasset'), {force: true});
    }
    log('preparing the native shader materials found in the game views');
    await prepareNativeShaders({engine: settings().engine, project: captureProject, game: gameFor(games.find(id => !built[id].page)), captured,
      coverage: {...priorCoverage, ...requiredCoverage}});
  }
  for (const [name, entry] of Object.entries(requiredCoverage)) {
    if (!fs.existsSync(path.join(captured, name + '.uasset'))) throw Error(`Shader ${entry.shader} is not ready; add its view to captureScripts and package again without --no-capture.`);
  }
  if (fs.existsSync(captured) && path.resolve(captured) !== path.resolve(project, 'Content/JsgbGenerated')) mirror(captured, path.join(project, 'Content/JsgbGenerated'));
  log(`${Object.keys(requiredCoverage).length} shader materials ready to cook`);
  if (!has('--host') && fs.existsSync(hostExe)) {
    log('compiling changed shader materials into the existing host');
    cookShaderPatch({engine: settings().engine, project: captureProject, captured, builds: settings().builds, host: path.join(out, 'host'), coverage: requiredCoverage});
  } else {
  linkFidelityContent();
  log(`packaging the Unreal host from ${project}`);
  const uat = path.resolve(path.dirname(settings().engine), '../../Build/BatchFiles/RunUAT.bat');
  // Puerts' build rules copy its scripts into the project's Content folder from more than one rules instance at once,
  // which sometimes fails with "being used by another process". A second attempt finds the files already copied.
  let r;
  for (let attempt = 1; attempt <= 2 && !(r?.status === 0); attempt++) r = spawnSync('cmd', ['/c', uat, 'BuildCookRun', `-project=${path.join(project, 'JsgbHost.uproject')}`, '-platform=Win64', '-clientconfig=Development',
    '-build', '-cook', '-stage', '-pak', '-iostore', '-archive', `-archivedirectory=${path.join(out, 'host')}`, '-map=/Engine/Maps/Entry', '-noP4', '-utf8output', '-unattended'],
    {stdio: 'inherit'});
  if (r.status !== 0 || !fs.existsSync(hostExe)) throw Error(`packaging the host failed (exit ${r.status})`);
  }
  fs.writeFileSync(coverageFile, JSON.stringify({...priorCoverage, ...requiredCoverage}, null, 1));
}
// The bridge's own scripts (jsgb-main.js and the overlay client), which the host reads from the plugin folder.
mirror(path.join(bridge, 'JavaScript'), path.join(out, 'host/Windows/JsgbHost/Plugins/JsGameBridge/JavaScript'));

for (const id of games) {
  const game = gameFor(id);
  const pub = built[id];
  const dest = path.join(out, 'games', id);
  fs.mkdirSync(dest, {recursive: true});
  // Every file the web version can load: the game's public folder, whole.
  mirror(path.resolve(game.repo, (game.public ?? ['public'])[0]), path.join(dest, 'public'));
  if (pub.page) {
    mirror(path.join(game.out, 'web'), path.join(dest, 'web'));
    pub.publicRoots = ['web', 'public'];
  } else {
    const bundle = path.basename(pub.bundle);
    for (const name of [bundle, bundle.replace(/\.mjs$/, '.css'), 'page.json', 'registry.json', 'overrides.json', 'shader-preparation.json', 'native-shader-coverage.json']) {
      if (fs.existsSync(path.join(game.out, name))) copy(path.join(game.out, name), path.join(dest, name));
    }
    mirror(path.join(game.out, 'jsgb'), path.join(dest, 'jsgb'));
    mirror(path.join(game.out, 'jsgb-store'), path.join(dest, 'jsgb-store'));
    copy(path.join(game.repo, game.index ?? 'index.html'), path.join(dest, game.index ?? 'index.html'));
    pub.bundle = bundle;
    pub.publicRoots = ['public', '.'];
  }
  fs.writeFileSync(path.join(dest, 'publication.json'), JSON.stringify(pub, null, 1));
  const name = game.title ?? id, flags = pub.page ? [] : ['-JsgbJsThread'];
  fs.writeFileSync(path.join(out, `Play ${name}.cmd`), [
    '@echo off',
    `rem ${name} in Unreal Engine through JsGameBridge. F6 switches the DLSS mode, F7 Frame Generation (off, 2x, 3x, 4x).`,
    'cd /d "%~dp0"',
    `start "" "%~dp0host\\Windows\\JsgbHost.exe" "-JsgbGame=%~dp0games\\${id}" -windowed -ResX=1920 -ResY=1080 -JsgbHud -JsgbDlssKeys -JsgbJitter ${flags.join(' ')} -ini:Engine:[/Script/Engine.UserInterfaceSettings]:bAllowHighDPIInGameMode=True -log=jsgb-${id}.log %*`,
    ''].join('\r\n'));
  log(`${id}: ${pub.sourceCommit.slice(0, 8)}${pub.sourceDirty ? ' (with uncommitted changes)' : ''}`);
}
copy(path.join(bridge, 'Tools/laptop-package-readme.txt'), path.join(out, 'README.txt'));
copy(path.join(bridge, 'Tools/laptop-smoke.ps1'), path.join(out, 'smoke.ps1'));

// The smoke test runs here, on the package as built, before anything is copied.
if (!has('--no-smoke')) {
  const smoke = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(out, 'smoke.ps1'),
    '-Games', games.map(id => `${id}=${gameFor(id).title ?? id}`).join(';')], {encoding: 'utf8'});
  const lines = smoke.stdout.split('\n').map(l => l.trim()).filter(l => / (PASS|FAIL)/.test(l));
  for (const l of lines) log(`smoke: ${l}`);
  // The smoke runs recorded every pipeline state the games drew with (-logPSO). With the cook's stable shader keys they
  // collect in the project's Saved/JsgbPipelineRecordings, and Unreal's ShaderPipelineCacheTools turns them all into
  // Build/Windows/PipelineCaches/JsgbHost_PCD3D_SM6.spc. The next --host package bundles that: the player's GPU driver
  // then compiles every pipeline behind the loading screen.
  const recorded = path.join(out, 'host/Windows/JsgbHost/Saved/CollectedPSOs'), recordings = path.join(project, 'Saved/JsgbPipelineRecordings');
  const keys = path.join(project, 'Saved/Cooked/Windows/JsgbHost/Metadata/PipelineCaches'), caches = path.join(project, 'Build/Windows/PipelineCaches');
  if (fs.existsSync(recorded)) {
    fs.mkdirSync(recordings, {recursive: true});
    for (const f of fs.readdirSync(recorded).filter(f => f.endsWith('.rec.upipelinecache'))) fs.copyFileSync(path.join(recorded, f), path.join(recordings, f));
    if (fs.existsSync(keys)) for (const f of fs.readdirSync(keys).filter(f => f.endsWith('.shk'))) fs.copyFileSync(path.join(keys, f), path.join(recordings, f));
    fs.mkdirSync(caches, {recursive: true});
    const editorCmd = path.join(path.dirname(settings().engine), 'UnrealEditor-Cmd.exe');
    const r = spawnSync(editorCmd, [path.join(project, 'JsgbHost.uproject'), '-run=ShaderPipelineCacheTools', 'expand',
      path.join(recordings, '*.rec.upipelinecache'), path.join(recordings, '*.shk'), path.join(caches, 'JsgbHost_PCD3D_SM6.spc'), '-unattended', '-nosplash'], {encoding: 'utf8'});
    const total = /Generated (\d+) stable PSOs/.exec(r.stdout ?? '')?.[1];
    log(total ? `${total} pipeline states ready for the next host package` : `expanding the pipeline recordings failed (exit ${r.status})`);
  }
  if (lines.length !== games.length || lines.some(l => / FAIL/.test(l))) throw Error(`smoke test failed, nothing copied:\n${smoke.stdout}${smoke.stderr}`);
}
log(`done: ${out}`);

// Lumen mode's override models (Games/<game>.json "overrides") are Unreal assets under /Game/Fidelity, imported into the
// project jsgb.local.json "fidelityContent" names (Tools/fidelity/build-overrides.mjs). The packaging project links that
// folder into its Content folder and always cooks it (the runtime loads the models by path), with the mesh distance
// fields Lumen traces.
function linkFidelityContent() {
  if (!games.some(id => gameFor(id).overrides)) return;
  const source = settings().fidelityContent;
  if (!source || !fs.existsSync(source)) { log('no fidelity content (jsgb.local.json "fidelityContent"): Lumen mode draws the games\' own models'); return; }
  const link = path.join(project, 'Content', 'Fidelity');
  if (!fs.existsSync(link)) fs.symlinkSync(path.resolve(source), link, 'junction');
  const addTo = (file, section, line) => {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!text.includes(line)) fs.writeFileSync(file, `${text.replace(/\s*$/, '')}\r\n\r\n${section}\r\n${line}\r\n`);
  };
  addTo(path.join(project, 'Config/DefaultGame.ini'), '[/Script/UnrealEd.ProjectPackagingSettings]', '+DirectoriesToAlwaysCook=(Path="/Game/Fidelity")');
  addTo(path.join(project, 'Config/DefaultEngine.ini'), '[/Script/Engine.RendererSettings]', 'r.GenerateMeshDistanceFields=True');
  log(`fidelity models from ${source} cook into the host`);
}
