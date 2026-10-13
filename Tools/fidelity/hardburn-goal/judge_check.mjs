// node judge_check.mjs <host log> <ship> [<ship> ...]: each gun of each judged ship, as the game running in Unreal has it,
// against the game's own mount export (mounts.json), and against what the bridge sent to Unreal for the high-detail model.
// Guns are paired by seat position. A gun fails when its seat is more than 1 cm off, an axis is more than 0.5 degrees
// off, it is another gun model than the export names, or no high-detail model drew for it.
import fs from 'node:fs';
const [logFile, ...ships] = process.argv.slice(2);
const log = fs.readFileSync(logFile, 'latin1');
const mounts = JSON.parse(fs.readFileSync('G:/JsGameBridge-fidelity-order/mounts.json', 'utf8'));
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) * 180 / Math.PI;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const id = m => String(m ?? '').replace(/^.*\/(pixal\/[^/]+?)(\.glb)?$/, '$1');
let failed = 0, total = 0;
ships.forEach((ship, index) => {
  const parts = [];
  for (const m of log.matchAll(new RegExp(`-> JP${index}_(\d\d) (.*)`, 'g'))) parts[+m[1]] = m[2].replace(/\r/g, '');
  let data; try { data = JSON.parse(parts.join('')); } catch { console.log(`${ship}: NO DATA in the log`); failed++; return; }
  const entry = mounts.list.find(s => s.ship === ship), left = entry.guns.slice();
  // The hull's length in metres over its length in model units turns model units into centimetres.
  const cm = 100 * (entry.hull?.lengthMetres ?? entry.hull?.metres ?? 0) / (entry.hull?.length || 1) || 100;
  console.log(`${ship}: ${data.guns.length} guns in Unreal, ${entry.guns.length} in the export (${entry.guns.filter(g => g.underside).length} on the underside); hull drawn: ${data.hull.join(' ') || 'the high-detail model'}`);
  for (const g of data.guns) {
    total++;
    let want = null, best = Infinity;
    for (const w of left) { const d = dist(g.seat, w.seat); if (d < best) { best = d; want = w; } }
    if (!want) { failed++; console.log(`  FAIL ${g.name}: no gun left in the export to pair with`); continue; }
    left.splice(left.indexOf(want), 1);
    const seat = best * cm, up = ang(g.up, want.up), fwd = ang(g.fwd, want.forward);
    const sent = g.ue ? Math.max(ang(g.ue.up, g.up), ang(g.ue.fwd, g.fwd)) : null, rightModel = id(g.gunModel) === id(want.model);
    const bad = seat > 1 || up > 0.5 || fwd > 0.5 || sent === null || sent > 0.5 || !rightModel;
    if (bad) failed++;
    console.log(`  ${bad ? 'FAIL' : 'ok  '} ${(want.list + ':' + want.slot).padEnd(11)} ${id(want.model).padEnd(36)}${want.underside ? ' underside' : '          '} seat ${seat.toFixed(2)} cm, up ${up.toFixed(3)}, forward ${fwd.toFixed(3)} deg; ` +
      (g.ue ? `high-detail ${g.ue.key.replace(/^.*\//, '')}, ${sent.toFixed(3)} deg from the game's gun` : 'NO high-detail model drew') + (rightModel ? '' : `; the game here fitted ${id(g.gunModel)}`));
  }
  if (left.length) { failed += left.length; console.log(`  FAIL ${left.length} guns in the export have no gun in Unreal: ${left.map(w => w.list + ':' + w.slot).join(' ')}`); }
});
console.log(`${total} guns on ${ships.length} ships, ${failed} failed`);
process.exit(failed ? 1 : 0);
