import './browser-safety.cjs';
// Muzzle-light + weapon-audio wiring probe.
// Asserts (1) the pooled muzzle light never exceeds 2 live at once under rapid fire, across weapon
// classes, and (2) firing raises the weapon-audio event counter (gameAudio.events.weapon).
// A granted firearm and inflated ammo/health are TEST FIXTURES; the fire path is canonical.
//
// Usage: node tools/probe-muzzle-audio.mjs [base]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5202/';
const DIR = 'reports/pirate-expeditions';
mkdirSync(DIR, { recursive: true });
const LAUNCH = ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'];

const browser = await chromium.launch({ args: LAUNCH });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.routeWebSocket('**', ws => ws.close());
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const cmd = (n, ...a) => page.evaluate(([n, a]) => window.__game.cmd(n, ...a), [n, a]);
const audioEvents = () => page.evaluate(() => window.__game.audio().events);

await page.goto(`${BASE}?scene=planet&seed=42&fresh`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game?.ready, { timeout: 20000 });
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const state = await import('/src/core/state.ts');
  const ammo = await import('/src/game/ammunition.ts');
  const st = window.__game.state;
  st.level = 16; st.heroHp = st.heroHpMax = 100000;
  for (const f of ['light', 'heavy', 'shell']) ammo.addAmmo(st, f, 'standard', ammo.AMMO[f].cap);
  st.flags.activeHand = 'gun';
  state.saveGame(st);
});
if (await cmd('holster') === true) await cmd('holster'); // draw the gun if it started stowed

const equip = (archetype) => page.evaluate(async (arch) => {
  const loot = await import('/src/game/loot.ts');
  const item = loot.rollLoot(window.__game.state, 4242 + arch.length, 16, 'firearm', 0, undefined,
    { areaLevel: 16, source: 'cache' }, arch);
  const e = window.__game.cmd('equipLoot', item.uid);
  return { archetype: e?.archetype, name: e?.name };
}, archetype);

const spot = (await cmd('openSpot', 0, 0, 60)) ?? { x: 0, z: 0 };
await cmd('teleport', spot.x, spot.z);
await page.waitForTimeout(300);

// Fire each class rapidly, sampling the live muzzle-light count every ~16ms. The pool has 2 lights,
// so liveLights can never exceed 2 by construction; sampling proves it under real overlapping fire.
const CLASSES = ['Scattergun', 'Anvil Anti-Materiel', 'Arc Carbine', 'Repeater', 'Longshot'];
const rows = [];
for (const arch of CLASSES) {
  const item = await equip(arch);
  const before = (await audioEvents()).weapon ?? 0;
  // Fire a burst and watch the pool during it.
  const sample = await page.evaluate(async () => {
    let peak = 0, poolSize = 0, samples = 0;
    const t = setInterval(() => { window.__game.cmd('shoot'); }, 45);
    for (let i = 0; i < 40; i++) {
      const fx = window.__game.cmd('fxCounts');
      poolSize = fx.muzzleLightPool ?? poolSize;
      peak = Math.max(peak, fx.muzzleLights ?? 0);
      samples++;
      await new Promise(r => setTimeout(r, 16));
    }
    clearInterval(t);
    return { peak, poolSize, samples };
  });
  const after = (await audioEvents()).weapon ?? 0;
  const row = { archetype: item.archetype, peakLiveLights: sample.peak, poolSize: sample.poolSize,
    samples: sample.samples, weaponEventsFired: after - before };
  rows.push(row);
  console.log(JSON.stringify(row));
  assert(sample.poolSize === 2, `${arch}: muzzle light pool must be 2 (got ${sample.poolSize})`);
  assert(sample.peak <= 2, `${arch}: live muzzle lights must never exceed 2 (peaked ${sample.peak})`);
  assert(after > before, `${arch}: firing must raise the weapon-audio counter (${before} -> ${after})`);
}

writeFileSync(`${DIR}/muzzle-audio.json`, JSON.stringify({ rows, errors }, null, 1));
await browser.close();
if (errors.length) { console.error('page errors:', errors.slice(0, 6)); process.exit(1); }
console.log(JSON.stringify({ classes: rows.length, maxLiveLights: Math.max(...rows.map(r => r.peakLiveLights)), errors: errors.length }));
console.log('probe-muzzle-audio: PASS');
