// node judge_check.mjs <host log> <ship> [<ship> ...]: each gun of each judged ship, as the game running in Unreal has it,
// against the game's own ship judge (mounts.json), and against what the bridge sent to Unreal for the high-detail model.
// A gun fails when its seat is more than 1 cm off, an axis is more than 0.5 degrees off, or no high-detail model drew.
import fs from 'node:fs';
const [logFile, ...ships] = process.argv.slice(2);
const log = fs.readFileSync(logFile, 'latin1');
const mounts = JSON.parse(fs.readFileSync('C:/UnlitWorldsCaptures/judge/hardburn-ship-judge/mounts.json', 'utf8'));
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) * 180 / Math.PI;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
let failed = 0, total = 0;
ships.forEach((ship, index) => {
  const parts = [];
  for (const m of log.matchAll(new RegExp(`-> JP${index}_(\\d\\d) (.*)`, 'g'))) parts[+m[1]] = m[2].replace(/\r/g, '');
  let data; try { data = JSON.parse(parts.join('')); } catch { console.log(`${ship}: NO DATA in the log`); failed++; return; }
  const entry = mounts.ships.find(s => s.ship === ship);
  console.log(`${ship}: ${data.guns.length} guns in Unreal, ${entry.guns.length} in the game's judge; hull drawn: ${data.hull.join(' ') || 'high-detail model'}`);
  for (const g of data.guns) {
    const slot = +(/slot-(\d+)$/.exec(g.name) ?? [])[1], want = entry.guns.find(x => x.slot === slot);
    total++;
    if (!want?.seat) { console.log(`  ${g.name}: not in the game's judge`); continue; }
    const seat = dist(g.seat, want.seat) * 100, up = ang(g.up, want.up), fwd = ang(g.fwd, want.forward);
    const sent = g.ue ? Math.max(ang(g.ue.up, g.up), ang(g.ue.fwd, g.fwd)) : null;
    const rightModel = g.gunModel === want.model;
    const bad = seat > 1 || up > 0.5 || fwd > 0.5 || sent === null || sent > 0.5 || !rightModel;
    if (bad) failed++;
    console.log(`  ${bad ? 'FAIL' : 'ok  '} slot ${slot} ${String(want.model).padEnd(34)} seat ${seat.toFixed(2)} cm, up ${up.toFixed(3)}, forward ${fwd.toFixed(3)} deg; ` +
      (g.ue ? `high-detail ${g.ue.key}, ${sent.toFixed(3)} deg from the game's gun` : 'NO high-detail model drew') + (rightModel ? '' : `; the game here fitted ${g.gunModel}`));
  }
});
console.log(`${total} guns on ${ships.length} ships, ${failed} failed`);
process.exit(failed ? 1 : 0);
