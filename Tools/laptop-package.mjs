#!/usr/bin/env node
// Builds the play package for another PC from the latest game sources, then copies what changed to that PC and puts
// launchers on its desktop. One command refreshes everything:
//   node Tools/laptop-package.mjs [--to zeph] [--host] [--games hardburn,unlit,saltblade] [--out C:/JsgbPackage/JsGameBridge]
// --host packages the Unreal host again (after a change to the plugin's C++ or the engine plugins). It needs the
// packaging project (--project, default F:/JsgbPackage/project) with the plugins linked into its Plugins folder.
// --to <ssh host> copies the package to C:\JsgbPackage\JsGameBridge on that Windows PC, only the files that changed
// since the last copy, and makes one desktop shortcut per game.
import fs from 'node:fs';
import path from 'node:path';
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
  log(`packaging the Unreal host from ${project}`);
  const uat = path.resolve(path.dirname(settings().engine), '../../Build/BatchFiles/RunUAT.bat');
  const r = spawnSync('cmd', ['/c', uat, 'BuildCookRun', `-project=${path.join(project, 'JsgbHost.uproject')}`, '-platform=Win64', '-clientconfig=Development',
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
    `start "" "%~dp0host\\Windows\\JsgbHost.exe" "-JsgbGame=%~dp0games\\${id}" -windowed -ResX=1920 -ResY=1080 -JsgbHud -JsgbDlssKeys -JsgbDLSS=dlaa ${flags.join(' ')} -log=jsgb-${id}.log`,
    ''].join('\r\n'));
  log(`${id}: ${pub.sourceCommit.slice(0, 8)}${pub.sourceDirty ? ' (with uncommitted changes)' : ''}`);
}
copy(path.join(bridge, 'Tools/laptop-package-readme.txt'), path.join(out, 'README.txt'));

if (remote) await sync(remote);
log(`done: ${out}`);

// Copies the files whose size or time changed since the last copy (tar over ssh), deletes the ones that are gone, and
// makes the desktop shortcuts.
async function sync(host) {
  const manifestFile = path.join(out, `.synced-${host}.json`);
  const before = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const now = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(out, dir), {withFileTypes: true})) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.synced-') || rel === 'host/Windows/JsgbHost/Saved') continue;
      if (entry.isDirectory()) walk(rel);
      else { const s = fs.statSync(path.join(out, rel)); now[rel] = `${s.size}:${Math.round(s.mtimeMs)}`; }
    }
  };
  walk('');
  const changed = Object.keys(now).filter(f => before[f] !== now[f]);
  const gone = Object.keys(before).filter(f => !(f in now));
  log(`copying ${changed.length} changed files to ${host} (${gone.length} to delete)`);
  const ssh = (command, input) => spawnSync('ssh', ['-o', 'BatchMode=yes', host, command], {encoding: 'utf8', input});
  ssh(`powershell -NoProfile -Command "New-Item -ItemType Directory -Force '${remoteDir}' | Out-Null"`);
  if (changed.length) {
    const list = path.join(out, `.synced-${host}-list.txt`);
    fs.writeFileSync(list, changed.join('\n') + '\n');
    // Windows' own tar on both ends; the list holds paths relative to the package folder.
    await new Promise((resolve, reject) => {
      const tar = spawn('C:/Windows/System32/tar.exe', ['-cf', '-', '-C', out, '-T', list]);
      const ssh = spawn('ssh', ['-o', 'BatchMode=yes', host, `tar -xf - -C "${remoteDir}"`], {stdio: ['pipe', 'inherit', 'inherit']});
      tar.stdout.pipe(ssh.stdin);
      tar.stderr.pipe(process.stderr);
      ssh.on('close', code => code === 0 ? resolve() : reject(Error(`copy to ${host} failed (exit ${code})`)));
    });
    fs.rmSync(list);
  }
  if (gone.length) {
    const r = ssh('powershell -NoProfile -Command -', gone.map(f => `Remove-Item -LiteralPath '${remoteDir}\\${f.replaceAll('/', '\\').replaceAll("'", "''")}' -Force -ErrorAction SilentlyContinue`).join('\n'));
    if (r.status !== 0) log(`deleting old files on ${host} failed: ${r.stderr}`);
  }
  fs.writeFileSync(manifestFile, JSON.stringify(now));
  // One shortcut per game on the desktop, named after the game.
  const shortcuts = games.map(id => GAMES[id]?.name ?? id).map(name =>
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\${name} (Unreal).lnk'); ` +
    `$s.TargetPath = '${remoteDir}\\Play ${name}.cmd'; $s.WorkingDirectory = '${remoteDir}'; $s.IconLocation = '${remoteDir}\\host\\Windows\\JsgbHost.exe,0'; $s.Save()`).join('\n');
  const r = ssh('powershell -NoProfile -Command -', shortcuts);
  if (r.status !== 0) throw Error(`making the desktop shortcuts on ${host} failed: ${r.stderr}`);
  log(`copied to ${host}:${remoteDir}; desktop shortcuts: ${games.map(id => `${GAMES[id]?.name ?? id} (Unreal)`).join(', ')}`);
}
