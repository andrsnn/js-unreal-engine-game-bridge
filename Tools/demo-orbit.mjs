#!/usr/bin/env node
// The live-edit demo: adds or removes a small HUD label in Examples/orbit-demo/src/main.js.
// With "Play in Browser" and "Play in Unreal" running, both reload when the file is saved.
//   node Tools/demo.mjs feature on|off
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = path.join(bridge, 'Examples/orbit-demo/src/main.js');
const [command, arg] = process.argv.slice(2);
const MARK = '// jsgb-demo-feature';
const FEATURE = `
${MARK}
const liveLabel = document.createElement('div');
liveLabel.className = 'panel';
Object.assign(liveLabel.style, {left: '50%', top: '16px', transform: 'translateX(-50%)', color: '#ffd27a', borderColor: '#ffb43c', letterSpacing: '2px', fontWeight: '700'});
document.getElementById('hud').append(liveLabel);
setInterval(() => { liveLabel.textContent = 'LIVE EDIT · ' + new Date().toLocaleTimeString(); }, 250);
${MARK}-end
`;

if (command !== 'feature' || !['on', 'off'].includes(arg)) {
  console.log('usage: node Tools/demo.mjs feature on|off');
  process.exit(1);
}
let text = fs.readFileSync(main, 'utf8');
const start = text.indexOf('\n' + MARK + '\n');
if (start >= 0) text = text.slice(0, start) + text.slice(text.indexOf(MARK + '-end\n', start) + MARK.length + 5);
if (arg === 'on') text += FEATURE;
fs.writeFileSync(main, text);
console.log(`demo feature ${arg === 'on' ? 'added to' : 'removed from'} ${path.relative(bridge, main)}`);
