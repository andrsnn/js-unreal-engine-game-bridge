// node judge_cmp.mjs <ship>: the browser's and Unreal's JUDGE data for a ship, compared mount by mount.
import fs from 'node:fs';
const D = 'H:/captures/jsgb-fidelity/toggle/', ship = process.argv[2];
const read = (file, re) => { const log = fs.readFileSync(file, 'latin1'), parts = []; for (const m of log.matchAll(re)) parts[+m[1]] = m[2].replace(/\r/g, ''); return JSON.parse(parts.join('')); };
const ue = read(`${D}judge-ue-${ship}.log`, /-> JUDGEPART(\d\d) (.*)/g), web = read(`${D}judge-web.log`, /eval -> JUDGEPART(\d\d) (.*)/g);
const ang = (a, b) => { const n = Math.hypot(...a) * Math.hypot(...b); return Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / n)) * 180 / Math.PI; }, dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
console.log('hull on screen, browser:', web.hull.join(' '), '| Unreal:', ue.hull.join(' '));
for (const g of ue.guns) {
  const w = web.guns.find(x => x.name === g.name);
  console.log(g.name.padEnd(28), 'seat', (dist(g.seat, w.seat) * 100).toFixed(2), 'cm, up', ang(g.up, w.up).toFixed(3), 'deg, fwd', ang(g.fwd, w.fwd).toFixed(3), 'deg | high-detail:', g.ue ? g.ue.key : 'none');
  console.log('   browser meshes:', w.meshes.join(' '), '\n   Unreal meshes: ', g.meshes.join(' '));
}
fs.writeFileSync(`${D}judge-${ship}-data.json`, JSON.stringify({web, ue}, null, 1));
