/** A fixed seed (-JsgbSeed / conformance --seed) makes Math.random repeat, so a browser and an Unreal run of the
 *  same script build the same world. It's imported first, so the seed is in place before three.js loads, as the
 *  browser side seeds before the page's scripts run (Tools/web.mjs): libraries that draw numbers while they load
 *  then draw the same ones on both sides. */
import {host} from './host';

const g = globalThis as Record<string, any>;
export function seedRandom(seed: number) {
  let a = seed >>> 0;
  // __jsgbRandomCount: how many numbers were drawn, to find where two runs part ways.
  g.__jsgbRandomCount = 0;
  Math.random = () => { g.__jsgbRandomCount++; a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return seed;
}
if (host.seed) { seedRandom(host.seed); g.__jsgbReseed = () => seedRandom(host.seed); }
