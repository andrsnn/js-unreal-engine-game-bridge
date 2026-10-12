#!/usr/bin/env node
// Builds the play package for another PC from the latest game sources, smoke-tests it on this PC, then copies what
// changed to the other PC. Nothing runs on the other PC except the copy: it is someone's machine to play on.
//   node Tools/laptop-package.mjs [--to zeph] [--host] [--no-capture] [--games hardburn,unlit,saltblade] [--no-smoke] [--shortcuts]
//     [--out C:/JsgbPackage/JsGameBridge]
// --host packages the Unreal host again (after a change to the plugin's C++ or the engine plugins). Before that, an
// editor plays each three.js game through the "captureScripts" in its Games/<game>.json and saves every shader material
// it generates, so the package cooks them (--no-capture skips this). It needs the
// packaging project (--project, default F:/JsgbPackage/project) with the plugins linked into its Plugins folder.
// --to <ssh host> copies the package to C:\JsgbPackage\JsGameBridge on that Windows PC, only the files that changed
// since the last copy; --shortcuts also makes one desktop shortcut per game there.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build, loadGame, settings} from './jsgb.mjs';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const has = name => args.includes(name);
const out = path.resolve(flag('--out', 'C:/JsgbPackage/JsGameBridge'));
const project = path.resolve(flag('--project', 'F:/JsgbPackage/project'));
const remote = flag('--to');
const remoteDir = 'C:\\JsgbPackage\\JsGameBridge';
const log = t => console.log(`[package ${new Date().toTimeString().slice(0, 8)}] ${t}`);

// Each game: the launcher name, and the host flags it starts with. Three.js games run their JavaScript on its own thread.
// Games start with DLSS off: on the RTX 5080 laptop the driver keeps the GPU at 330-550 MHz (power state P5) most of the
// time while DLSS runs, and about one frame in ten then takes 17 to 40 ms. F6 turns DLSS on.
const GAMES = {
  hardburn: {name: 'Hard Burn', flags: ['-JsgbJsThread']},
  unlit: {name: 'Unlit Worlds', flags: ['-JsgbJsThread']},
  saltblade: {name: 'Saltblade', flags: []},
};
const games = flag('--games', Object.keys(GAMES).join(',')).split(',');

// robocopy /MIR copies only what changed and removes what's gone. Exit codes under 8 mean success.
function mirror(from, to) {
  const r = spawnSync('robocopy', [from, to, '/MIR', '/MT:16', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {encoding: 'utf8'});
  if (r.status >= 8) throw Error(`robocopy ${from} -> ${to} failed (${r.status}): ${r.stdout}`);
}
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(from, to); };

fs.mkdirSync(out, {recursive: true});
const hostExe = path.join(out, 'host/Windows/JsgbHost.exe');
if (has('--host') || !fs.existsSync(hostExe)) {
  // Generated shader materials captured in editor runs (-JsgbSaveMaterials) cook into the host, so a packaged game
  // draws its own shaders without compiling anything.
  // First the editor plays each three.js game through its "captureScripts" and saves every material it generates.
  if (!has('--no-capture')) for (const id of games) {
    const game = loadGame(id);
    for (const run of game.captureScripts ?? []) {
      log(`capturing ${id}'s materials with ${run.script}`);
      spawnSync(process.execPath, [path.join(bridge, 'Tools/run-unreal.mjs'), id, '--offscreen', '--res', '1920x1080', '--js-thread', '--script', run.script,
        '--timeout', String(run.timeout ?? 420), ...(run.search ? ['--search', run.search] : []), '--ue', '-JsgbSaveMaterials'], {stdio: 'inherit'});
    }
  }
  const captured = path.join(path.dirname(settings().project), 'Content', 'JsgbGenerated');
  if (fs.existsSync(captured)) { mirror(captured, path.join(project, 'Content', 'JsgbGenerated')); log(`${fs.readdirSync(captured).length} captured materials to cook`); }
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
// The bridge's own scripts (jsgb-main.js and the overlay client), which the host reads from the plugin folder.
mirror(path.join(bridge, 'JavaScript'), path.join(out, 'host/Windows/JsgbHost/Plugins/JsGameBridge/JavaScript'));

for (const id of games) {
  const game = loadGame(id);
  log(`building ${id} from ${game.repo}`);
  const pub = await build(game);
  const dest = path.join(out, 'games', id);
  fs.mkdirSync(dest, {recursive: true});
  // Every file the web version can load: the game's public folder, whole.
  mirror(path.resolve(game.repo, (game.public ?? ['public'])[0]), path.join(dest, 'public'));
  if (pub.page) {
    mirror(path.join(game.out, 'web'), path.join(dest, 'web'));
    pub.publicRoots = ['web', 'public'];
  } else {
    const bundle = path.basename(pub.bundle);
    for (const name of [bundle, bundle.replace(/\.mjs$/, '.css'), 'page.json', 'registry.json']) {
      if (fs.existsSync(path.join(game.out, name))) copy(path.join(game.out, name), path.join(dest, name));
    }
    mirror(path.join(game.out, 'jsgb'), path.join(dest, 'jsgb'));
    copy(path.join(game.repo, game.index ?? 'index.html'), path.join(dest, game.index ?? 'index.html'));
    pub.bundle = bundle;
    pub.publicRoots = ['public', '.'];
  }
  fs.writeFileSync(path.join(dest, 'publication.json'), JSON.stringify(pub, null, 1));
  const {name, flags} = GAMES[id] ?? {name: game.title ?? id, flags: []};
  fs.writeFileSync(path.join(out, `Play ${name}.cmd`), [
    '@echo off',
    `rem ${name} in Unreal Engine through JsGameBridge. F6 switches the DLSS mode, F7 Frame Generation (off, 2x, 3x, 4x).`,
    'cd /d "%~dp0"',
    `start "" "%~dp0host\\Windows\\JsgbHost.exe" "-JsgbGame=%~dp0games\\${id}" -windowed -ResX=1920 -ResY=1080 -JsgbHud -JsgbDlssKeys -JsgbJitter ${flags.join(' ')} -log=jsgb-${id}.log %*`,
    ''].join('\r\n'));
  log(`${id}: ${pub.sourceCommit.slice(0, 8)}${pub.sourceDirty ? ' (with uncommitted changes)' : ''}`);
}
copy(path.join(bridge, 'Tools/laptop-package-readme.txt'), path.join(out, 'README.txt'));
copy(path.join(bridge, 'Tools/laptop-smoke.ps1'), path.join(out, 'smoke.ps1'));

// The smoke test runs here, on the package as built, before anything is copied.
if (!has('--no-smoke')) {
  const smoke = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(out, 'smoke.ps1'),
    '-Games', games.map(id => `${id}=${GAMES[id]?.name ?? id}`).join(';')], {encoding: 'utf8'});
  const lines = smoke.stdout.split('\n').map(l => l.trim()).filter(l => / (PASS|FAIL)/.test(l));
  for (const l of lines) log(`smoke: ${l}`);
  if (lines.length !== games.length || lines.some(l => / FAIL/.test(l))) throw Error(`smoke test failed, nothing copied:\n${smoke.stdout}${smoke.stderr}`);
  // The smoke runs recorded every pipeline state the games drew with (-logPSO). With the cook's stable shader keys,
  // they go to the project's Build/Windows/PipelineCaches, and the next --host package bundles them: the player's GPU
  // driver then compiles them all behind the loading screen.
  const recorded = path.join(out, 'host/Windows/JsgbHost/Saved/CollectedPSOs'), caches = path.join(project, 'Build/Windows/PipelineCaches');
  const keys = path.join(project, 'Saved/Cooked/Windows/JsgbHost/Metadata/PipelineCaches');
  if (fs.existsSync(recorded)) {
    fs.mkdirSync(caches, {recursive: true});
    let kept = 0;
    for (const f of fs.readdirSync(recorded).filter(f => f.endsWith('.rec.upipelinecache'))) { fs.copyFileSync(path.join(recorded, f), path.join(caches, f)); ++kept; }
    if (fs.existsSync(keys)) for (const f of fs.readdirSync(keys).filter(f => f.endsWith('.shk'))) fs.copyFileSync(path.join(keys, f), path.join(caches, f));
    log(`${kept} pipeline recordings kept for the next host package`);
  }
}
if (remote) await sync(remote);
log(`done: ${out}`);

// SHA-256 of a file of any size, read in 8 MB pieces.
function sha256File(file) {
  const hash = createHash('sha256'), buf = Buffer.alloc(8 << 20), fd = fs.openSync(file, 'r');
  for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) hash.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return hash.digest('hex').toUpperCase();
}

// Copies the package to the other PC. Game files go when their size or time changed. The host (executable, paks,
// shader libraries) only works as a matching set, so when any host file changed the whole host goes to a staging
// folder, every file is checked by SHA-256 there, and only then does it replace the old host. A game running there
// is never closed: while one runs, the new host stays staged and the copy reports it.
async function sync(host) {
  const manifestFile = path.join(out, `.synced-${host}.json`);
  const before = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const now = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(out, dir), {withFileTypes: true})) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.synced-') || rel === 'host/Windows/JsgbHost/Saved' || rel === 'smoke') continue;
      if (entry.isDirectory()) walk(rel);
      else { const s = fs.statSync(path.join(out, rel)); now[rel] = `${s.size}:${Math.round(s.mtimeMs)}`; }
    }
  };
  walk('');
  const isHost = f => f.startsWith('host/');
  const hostFiles = Object.keys(now).filter(isHost);
  const hostChanged = has('--host') || Object.keys(now).some(f => isHost(f) && before[f] !== now[f]) || Object.keys(before).some(f => isHost(f) && !(f in now));
  const changed = Object.keys(now).filter(f => !isHost(f) && before[f] !== now[f]);
  const gone = Object.keys(before).filter(f => !isHost(f) && !(f in now));
  const ssh = (command, input) => spawnSync('ssh', ['-o', 'BatchMode=yes', host, command], {encoding: 'utf8', input, maxBuffer: 64 << 20});
  const ps = script => ssh('powershell -NoProfile -Command -', script);
  const tarTo = (files, dest) => new Promise((resolve, reject) => {
    const list = path.join(out, `.synced-${host}-list.txt`);
    fs.writeFileSync(list, files.join('\n') + '\n');
    // Windows' own tar on both ends; the list holds paths relative to the package folder.
    const tar = spawn('C:/Windows/System32/tar.exe', ['-cf', '-', '-C', out, '-T', list]);
    const pipe = spawn('ssh', ['-o', 'BatchMode=yes', host, `tar -xf - -C "${dest}"`], {stdio: ['pipe', 'inherit', 'inherit']});
    tar.stdout.pipe(pipe.stdin);
    tar.stderr.pipe(process.stderr);
    pipe.on('close', code => { fs.rmSync(list, {force: true}); code === 0 ? resolve() : reject(Error(`copy to ${host} failed (exit ${code})`)); });
  });
  const stage = `${remoteDir}\\.stage`;
  ps(`New-Item -ItemType Directory -Force '${remoteDir}' | Out-Null; Remove-Item -Recurse -Force '${stage}' -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force '${stage}' | Out-Null`);
  if (hostChanged) {
    log(`copying the whole host (${hostFiles.length} files) to ${host}:${stage}`);
    await tarTo(hostFiles, stage);
    // Every host file, checked by SHA-256 on the other PC.
    const sums = {};
    for (const f of hostFiles) sums[f.replaceAll('/', '\\')] = sha256File(path.join(out, f));
    const check = ps(`$want = '${JSON.stringify(sums).replaceAll("'", "''")}' | ConvertFrom-Json; $bad = 0; ` +
      `foreach ($p in $want.PSObject.Properties) { $f = Join-Path '${stage}' $p.Name; if (-not (Test-Path -LiteralPath $f) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash -ne $p.Value) { $bad++; if ($bad -le 5) { "mismatch: " + $p.Name } } }; "bad=$bad"`);
    if (!/bad=0/.test(check.stdout)) throw Error(`the host copy on ${host} failed its checksum check: ${check.stdout.trim()} ${check.stderr.trim()}`);
    log(`host checksums match on ${host} (${hostFiles.length} files)`);
  }
  if (hostChanged) {
    // A running game holds the host's files open, so the rename fails and the new host stays staged.
    const swap = ps(`$h = '${remoteDir}\\host'; if (Test-Path $h) { Rename-Item $h 'host.old' -ErrorAction Stop }; Move-Item '${stage}\\host' $h -ErrorAction Stop; ` +
      `Remove-Item -Recurse -Force '${remoteDir}\\host.old' -ErrorAction SilentlyContinue; 'swapped'`);
    if (!/swapped/.test(swap.stdout)) throw Error(`the new host is staged in ${host}:${stage} but a game there is using the old one; copy again once it's closed (${swap.stderr.trim()})`);
  }
  log(`copying ${changed.length} changed game files to ${host} (${gone.length} to delete)`);
  if (changed.length) await tarTo(changed, remoteDir);
  if (gone.length) {
    const r = ps(gone.map(f => `Remove-Item -LiteralPath '${remoteDir}\\${f.replaceAll('/', '\\').replaceAll("'", "''")}' -Force -ErrorAction SilentlyContinue`).join('\n'));
    if (r.status !== 0) log(`deleting old files on ${host} failed: ${r.stderr}`);
  }
  ps(`Remove-Item -Recurse -Force '${stage}' -ErrorAction SilentlyContinue`);
  fs.writeFileSync(manifestFile, JSON.stringify(now));
  if (!has('--shortcuts')) { log(`copied to ${host}:${remoteDir}`); return; }
  // One shortcut per game on the desktop, named after the game.
  const shortcuts = games.map(id => GAMES[id]?.name ?? id).map(name =>
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\${name} (Unreal).lnk'); ` +
    `$s.TargetPath = '${remoteDir}\\Play ${name}.cmd'; $s.WorkingDirectory = '${remoteDir}'; $s.IconLocation = '${remoteDir}\\host\\Windows\\JsgbHost.exe,0'; $s.Save()`).join('\n');
  const r = ps(shortcuts);
  if (r.status !== 0) throw Error(`making the desktop shortcuts on ${host} failed: ${r.stderr}`);
  log(`copied to ${host}:${remoteDir}; desktop shortcuts: ${games.map(id => `${GAMES[id]?.name ?? id} (Unreal)`).join(', ')}`);
}
