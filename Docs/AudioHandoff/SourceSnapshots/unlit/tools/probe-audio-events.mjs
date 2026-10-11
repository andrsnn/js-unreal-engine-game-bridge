import './browser-safety.cjs';
/**
 * Live probe for the sound pass: deploys a nest expedition, unlocks the real WebAudio graph and
 * plays the first fight for 20 s, reading `window.__game.audio()` (GameAudio.snapshot) the whole way.
 *
 * It asserts the beats of the pass actually FIRE in play — the arrival warning, an enemy voice, a
 * weapon, an impact and the held objective-work loop — and that the ducking bus reacts. It cannot
 * judge how any of it sounds.
 *
 *   npx vite --port 5202 --strictPort      (in another shell)
 *   node tools/probe-audio-events.mjs [http://127.0.0.1:5202/]
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync, writeFileSync} from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5202/';
const DIR = 'reports/audio-pass';
mkdirSync(DIR, {recursive: true});

const browser = await chromium.launch({args: [
  '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required',
]});
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
await page.routeWebSocket('**', ws => ws.close());
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});

const snap = () => page.evaluate(() => window.__game.snapshot());
const audio = () => page.evaluate(() => window.__game.audio());
const cmd = (n, ...a) => page.evaluate(([name, args]) => window.__game.cmd(name, ...args), [n, a]);
const heal = () => page.evaluate(() => {const st = window.__game.state; st.heroHp = st.heroHpMax;});

// ---- deploy a nest (same fixture route as tools/probe-ground-ai.mjs) ---------
await page.goto(`${BASE}?scene=planet&seed=42&fresh`, {waitUntil: 'networkidle'});
await page.waitForFunction(() => window.__game?.ready, {timeout: 20000});
const site = await page.evaluate(async () => {
  const state = await import('/src/core/state.ts'); const library = await import('/src/core/saveLibrary.ts');
  const opening = await import('/src/game/pirateOpening.ts'); const sorties = await import('/src/game/pirateSorties.ts');
  const exp = await import('/src/game/pirateExpeditions.ts');
  const st = window.__game.state; opening.createPirateGame(st);
  st.campaign.opening = 'clear-mine'; st.flags.dungeon_pirate_mine_cleared = true; opening.mineClaimed(st);
  st.location = {mode: 'space'}; st.flags.fleetDock = 'pirate_base'; library.createJourney(st, 'audio probe');
  sorties.ensurePirateSorties(st); st.level = 6; st.heroHp = st.heroHpMax = 100000;
  const q = exp.ensureExpeditions(st); q.successes = 2; q.completed = ['nest', 'convoy'];
  for (let i = 0; i < 10 && !q.offers.some(o => o.family === 'nest'); i++) exp.refreshExpeditions(st);
  const offer = q.offers.find(o => o.family === 'nest'); if (!offer) return {error: 'nest not offered'};
  const r = exp.commitExpedition(st, offer, {...q.prep, difficulty: 'standard', groundCount: 40});
  if (!r.ok) return {error: r.error};
  const loot = await import('/src/game/loot.ts'); const ammo = await import('/src/game/ammunition.ts').catch(() => null);
  const gun = loot.rollLoot(st, 991, 6, 'firearm'); st.heroLoot.push(gun); st.heroLootEquipped.firearm = gun.uid; st.flags.activeHand = 'gun';
  ammo?.addAmmo?.(st, 'light', 'standard', 900); ammo?.addAmmo?.(st, 'heavy', 'standard', 900);
  return {saved: state.saveGame(st)};
});
assert(!site.error, site.error);

// The audio graph is created on the first real gesture, exactly as it is for a player.
await page.mouse.click(640, 400);
await page.evaluate(() => window.__game.setScene('dungeon'));
await page.waitForTimeout(2200);
await page.mouse.click(640, 400);
await page.waitForTimeout(400);

const opened = await audio();
assert(opened.active === true, 'the audio context did not start: ' + JSON.stringify({active: opened.active, scene: opened.scene}));
assert(opened.buses?.duck && opened.buses?.alert, 'ducking / alert buses missing: ' + JSON.stringify(opened.buses));

// ---- 20 s of the first fight ------------------------------------------------
const samples = [];
const started = Date.now();
let duckSeen = false, loopSeen = false, objectiveHeld = false;
for (let step = 0; Date.now() - started < 20000; step++) {
  await heal();
  const s = await snap();
  const hero = s.hero.pos;
  const live = (s.enemies ?? []).filter(e => !e.dead);
  // Walk onto the nearest live enemy and put rounds into it: weapon, impact, enemy voice, deaths.
  const target = live.map(e => ({e, d: Math.hypot(e.pos[0] - hero[0], e.pos[1] - hero[2])})).sort((a, b) => a.d - b.d)[0];
  if (target) {
    if (target.d > 26) await cmd('goto', target.e.pos[0], target.e.pos[1] + 11);
    await cmd('face', Math.atan2(target.e.pos[0] - hero[0], target.e.pos[1] - hero[2]));
    for (let k = 0; k < 3; k++) await cmd('shoot');
  }
  // Stand on the objective device and HOLD the interact key: that is the work loop and the provoke wave.
  const device = (s.expedition?.objectives ?? []).find(d => !d.done);
  if (device && step >= 3 && !objectiveHeld) {
    await cmd('goto', device.pos[0] + 1.1, device.pos[2] + 1.1);
    await cmd('key', 'KeyE', 2600);
    objectiveHeld = true;
    await page.waitForTimeout(1400);
  }
  const a = await audio();
  duckSeen ||= a.ducking?.active === true;
  loopSeen ||= a.loopVoices > 0;
  samples.push({t: +((Date.now() - started) / 1000).toFixed(1), voices: a.voices, loops: a.loopVoices, duck: a.ducking?.depth, suppressed: a.suppressed});
  await page.waitForTimeout(500);
}
await page.keyboard.up('KeyE').catch(() => {});
const final = await audio();
const events = final.events ?? {};
const count = prefix => Object.entries(events).filter(([k]) => k === prefix || k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);

const fired = {
  arrival_warning: count('arrival_') + count('warning:'),
  enemy_voice: count('enemy:'),
  weapon: ['rifle', 'smg', 'pistol', 'lmg', 'shotgun', 'sniper', 'pulse', 'rotary', 'plasma', 'arc', 'rail', 'suppressed', 'bow']
    .reduce((n, kind) => n + (events['played:' + kind] ?? 0), 0),
  impact: count('impact:'),
  objective_work: count('objective_work'),
  objective_provoke: count('objective_provoke'),
  footstep: count('footstep'),
  played_total: Object.entries(events).filter(([k]) => k.startsWith('played:')).reduce((n, [, v]) => n + v, 0),
  boss: count('boss:'),
  roll: count('roll_'),
  ui: count('ui_'),
};

const report = {
  when: new Date().toISOString(), base: BASE, seconds: 20,
  fired, duckSeen, loopSeen, samples, errors: errors.slice(0, 20),
  snapshot: {revision: final.revision, active: final.active, scene: final.scene, buses: final.buses,
    ducking: final.ducking, bedLevels: final.bedLevels, cues: final.cues.length, suppressed: final.suppressed},
  events,
};
writeFileSync(`${DIR}/audio-events.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({fired, duckSeen, loopSeen, errors: errors.length}, null, 1));

await browser.close();
assert(fired.arrival_warning >= 1, 'no arrival warning fired');
assert(fired.enemy_voice >= 1, 'no enemy voice fired');
assert(fired.weapon >= 1, 'no weapon voice played');
assert(fired.impact >= 1, 'no impact fired');
assert(fired.objective_work >= 1, 'the held objective-work loop never ran');
assert(fired.played_total >= 20, 'almost nothing reached a synthesized buffer: ' + fired.played_total);
assert(duckSeen, 'the ducking bus never moved');
assert(errors.length === 0, 'page errors: ' + errors.slice(0, 3).join(' | '));
console.log(`\nok · ${DIR}/audio-events.json`);
