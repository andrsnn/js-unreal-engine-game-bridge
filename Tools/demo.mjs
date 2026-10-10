#!/usr/bin/env node
// Demo helpers: a private, writable copy of a game to edit live, and one scripted feature to apply.
//   node Tools/demo.mjs prepare [game]     copy the game's last commit to <demo root>/<game> (public and node_modules are linked)
//   node Tools/demo.mjs feature on|off     add or remove the demo HUD label in the copy
// The copy is its own git repository, so the feature shows up as a one-file diff.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {loadGame} = await import(pathToFileURL(path.join(bridge, 'Tools/jsgb.mjs')).href);
const [command, arg] = process.argv.slice(2);
const demo = loadGame('hardburn-demo');
const git = (cwd, ...a) => execFileSync('git', ['--no-optional-locks', '-C', cwd, ...a], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

// The demo change: a fleet status label under the top bar, ticking once a second.
const MARK = '// jsgb-demo-feature';
const FEATURE = `
${MARK}
const fleetLabel = document.createElement('div');
fleetLabel.textContent = 'LIVE EDIT';
Object.assign(fleetLabel.style, {position: 'fixed', top: '58px', left: '50%', transform: 'translateX(-50%)', zIndex: 60, padding: '6px 16px',
  font: '700 15px sans-serif', letterSpacing: '2px', color: '#ffd27a', background: 'rgba(40, 24, 6, 0.85)', border: '1px solid #ffb43c'});
document.body.append(fleetLabel);
setInterval(() => { fleetLabel.textContent = 'LIVE EDIT · ' + new Date().toLocaleTimeString(); }, 1000);
${MARK}-end
`;

if (command === 'prepare') {
  const source = loadGame(arg ?? 'hardburn');
  if (fs.existsSync(demo.repo)) { console.log(`${demo.repo} already exists; delete it to make a fresh copy`); process.exit(0); }
  fs.mkdirSync(demo.repo, {recursive: true});
  const paths = ['src', source.index ?? 'index.html', 'package.json', 'vite.config.js'].filter(p => fs.existsSync(path.join(source.repo, p)));
  const tar = path.join(demo.repo, 'source.tar');
  execFileSync('git', ['--no-optional-locks', '-C', source.repo, 'archive', '--format=tar', '-o', tar, 'HEAD', ...paths]);
  execFileSync('tar', ['-xf', 'source.tar'], {cwd: demo.repo});
  fs.rmSync(tar);
  // Large folders are linked, not copied.
  for (const dir of ['public', 'node_modules']) fs.symlinkSync(path.join(source.repo, dir), path.join(demo.repo, dir), 'junction');
  fs.writeFileSync(path.join(demo.repo, '.gitignore'), 'public\nnode_modules\ndist\n');
  git(demo.repo, 'init', '-q');
  git(demo.repo, 'add', '-A');
  git(demo.repo, '-c', 'user.name=demo', '-c', 'user.email=demo@localhost', 'commit', '-q', '-m', `Copy of ${source.id} at ${git(source.repo, 'rev-parse', '--short', 'HEAD')}`);
  console.log(`prepared ${demo.repo} from ${source.repo}`);
} else if (command === 'feature') {
  const main = path.join(demo.repo, 'src/main.js');
  let text = fs.readFileSync(main, 'utf8');
  const start = text.indexOf('\n' + MARK + '\n');
  if (start >= 0) text = text.slice(0, start) + text.slice(text.indexOf(MARK + '-end\n', start) + MARK.length + 5);
  if (arg !== 'off') text += FEATURE;
  fs.writeFileSync(main, text);
  console.log(`demo feature ${arg === 'off' ? 'removed from' : 'added to'} ${main}`);
} else {
  console.log('usage: node Tools/demo.mjs prepare [game] | feature on|off');
  process.exit(1);
}
