#!/usr/bin/env node
// Plays a game in the live host project (jsgb.local.json "project"), full screen, the way a player would: no editor
// window, no test flags. It builds the game's bundle first, from the commit named in a file (--stable <file>, its first
// word; the commit is exported next to the builds folder and the game's repository isn't touched) or, without one, from
// the repository as it is.
//   node Tools/play-live.mjs hardburn [--stable G:/.../HB-STABLE.txt] [--windowed] [--res 2560x1440] [--lumen] [--ue "<args>"]
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build, loadGame, readJson, settings} from './jsgb.mjs';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [id = 'hardburn', ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const has = name => rest.includes(name);
const started = Date.now(), log = t => console.log(`[play ${((Date.now() - started) / 1000).toFixed(1)} s] ${t}`);

let game = loadGame(id);
const stable = flag('--stable');
const wanted = stable && fs.existsSync(stable) ? (fs.readFileSync(stable, 'utf8').match(/\b[0-9a-f]{7,40}\b/) ?? [])[0] : null;
if (wanted) {
  const commit = spawnSync('git', ['-C', game.repo, 'rev-parse', '--short=8', wanted + '^{commit}'], {encoding: 'utf8'}).stdout.trim();
  if (!commit) log(`no commit ${wanted} in ${game.repo}: playing the repository as it is`);
  else {
    const dir = path.join(path.dirname(game.out), 'sources', `${id}-${commit}`);
    if (!fs.existsSync(path.join(dir, '.jsgb-exported'))) {
      log(`exporting ${commit}`);
      fs.rmSync(dir, {recursive: true, force: true});
      fs.mkdirSync(dir, {recursive: true});
      const tar = `${dir}.tar`, winTar = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');
      if (spawnSync('git', ['-C', game.repo, 'archive', '--format=tar', '-o', tar, commit], {stdio: 'inherit'}).status !== 0 ||
          spawnSync(winTar, ['-xf', tar, '-C', dir], {stdio: 'inherit'}).status !== 0) throw Error(`exporting ${commit} failed`);
      fs.rmSync(tar);
      if (fs.existsSync(path.join(game.repo, 'node_modules'))) fs.symlinkSync(path.join(game.repo, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
      fs.writeFileSync(path.join(dir, '.jsgb-exported'), commit);
    }
    const file = `${dir}.json`, out = game.out;
    fs.writeFileSync(file, JSON.stringify({...readJson(path.join(bridge, 'Games', id + '.json')), id, repo: dir, out}, null, 1));
    game = loadGame(file);
    log(`playing ${commit}`);
  }
}
await build(game);
log('bundle built');

// The player's screen, unless --res gives one.
let [w, h] = (flag('--res') ?? '').split('x').map(Number);
if (!w || !h) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "$($b.Width)x$($b.Height)"'], {encoding: 'utf8'});
  [w, h] = (r.stdout.trim().match(/^(\d+)x(\d+)$/) ?? [0, 1920, 1080]).slice(1).map(Number);
}
const {engine, project} = settings();
const args = [project, '/Engine/Maps/Entry?game=/Script/JsGameBridge.JsgbGameMode', '-game', has('--windowed') ? '-windowed' : '-fullscreen', `-ResX=${w}`, `-ResY=${h}`,
  `-JsgbGame=${game.out}`, '-JsgbDlssKeys', '-JsgbJitter', '-nosplash', '-DisablePython', `-log=jsgb-${id}-play.log`];
if (has('--lumen')) args.push('-JsgbLumen');
// --js-thread: the game's JavaScript on its own thread (needs Puerts built thread safe).
if (has('--js-thread')) args.push('-JsgbJsThread');
if (flag('--ue')) args.push(...flag('--ue').match(/(?:[^\s"]+|"[^"]*")+/g).map(a => a.replace(/"/g, '')));
spawn(engine, args, {stdio: 'ignore', detached: true}).unref();
log(`started ${path.basename(engine)} at ${w}x${h}; log ${path.join(path.dirname(project), 'Saved/Logs', `jsgb-${id}-play.log`)}`);
