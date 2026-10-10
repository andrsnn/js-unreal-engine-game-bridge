// Debug helper: which mirror record kind makes a running host's frame white (hides one kind at a time).
import {execFileSync} from 'node:child_process';
const base = 'http://127.0.0.1:5292/bridge';
const wait = s => new Promise(r => setTimeout(r, s * 1000));
async function sample(label, mask) {
  await fetch(`${base}/describe`, {method: 'POST', body: `hide:${mask}`});
  await wait(2.5);
  const file = `G:/JsGameBridgeBuilds/hardburn/probe/kinds-${label}.png`;
  await fetch(`${base}/capture`, {method: 'POST', body: file});
  await wait(1.5);
  const px = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', 'crop=8:8:900:500,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  console.log(label.padEnd(12), [...px].join(','));
}
await sample('none', 0);
for (const [name, kind] of [['mesh', 1], ['instanced', 2], ['sprite', 4], ['points', 5], ['lines', 6], ['asset', 7]]) await sample(name, 1 << kind);
await sample('all', 0xfe);
await sample('restored', 0);
