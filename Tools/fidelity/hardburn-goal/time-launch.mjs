// node time-launch.mjs <name> [seconds]: double-clicks the desktop shortcut, records the screen, and times each stage.
import fs from 'node:fs'; import {spawn, spawnSync} from 'node:child_process';
const [name = 'launch', seconds = '100'] = process.argv.slice(2), O = 'H:/captures/jsgb-goal/';
const log = 'H:/builds/HardBurnUnreal-play/host/Windows/JsgbHost/Saved/Logs/jsgb-hardburn.log', times = process.env.TEMP + '/jsgb-launch-hardburn.txt';
const sleep = ms => new Promise(r => setTimeout(r, ms));
spawnSync('taskkill', ['/F', '/IM', 'JsgbHost.exe'], {stdio: 'ignore'}); await sleep(2000);
const rec = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'ddagrab=framerate=30', '-t', seconds, '-c:v', 'h264_nvenc', '-cq', '24', `${O}${name}.mp4`], {stdio: 'ignore'});
const recorded = new Promise(r => rec.on('exit', r));
try { fs.rmSync(log); } catch {} try { fs.rmSync(times); } catch {}
await sleep(3000);
const t0 = Date.now(), out = [`${name}: double-click at ${new Date().toTimeString().slice(0, 8)}`];
spawn('powershell', ['-NoProfile', '-Command', "Start-Process -FilePath 'C:/Users/Aidan Anderson/Desktop/Hard Burn (Unreal).lnk'"], {stdio: 'ignore', detached: true}).unref();
let ready = 0;
for (; Date.now() - t0 < 240e3 && !ready; await sleep(100)) { try { if (/js ready game entry evaluated/.test(fs.readFileSync(log, 'latin1'))) ready = Date.now(); } catch {} }
const mark = Object.fromEntries((fs.existsSync(times) ? fs.readFileSync(times, 'utf8') : '').trim().split(/\r?\n/).map(l => l.split(' ')).map(([k, v]) => [k, +v]));
const s = t => t ? ((t - t0) / 1000).toFixed(1) + ' s' : 'never';
out.push(`  launch window on screen: ${s(mark.shown)}`, `  Unreal started: ${s(mark.unreal)}`, `  Unreal's own window with its loading screen: ${s(mark.window)}`, `  game ready: ${s(ready)}`);
console.log(out.join('\n')); fs.writeFileSync(`${O}${name}.txt`, out.join('\n') + '\n');
await recorded;
