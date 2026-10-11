import assert from 'node:assert/strict';
import { HULL_PROFILES, hullImpulse, hullProfile, quietPhrase } from '../src/audio-acoustics.js';
for (const rate of [24000, 44100, 48000, 96000]) {
 for (const profile of Object.keys(HULL_PROFILES)) {
  const first = hullImpulse(profile, rate), second = hullImpulse(profile, rate);
  assert.equal(first.length, 2);
  for (let channel = 0; channel < 2; channel++) {
   assert.deepEqual(first[channel], second[channel], 'Response must be reproducible');
   assert(first[channel].length <= Math.ceil(rate * .32));
   let energy = 0;
   for (const sample of first[channel]) { assert(Number.isFinite(sample) && Math.abs(sample) < 1); energy += sample * sample; }
   assert(Math.abs(energy - .42) < .001, 'Energy should not change with hardware sample rate');
  }
 }
}
const camera = { x: 0, y: 0, z: 0 }, options = { bridge: false, audible: id => id === 'home' };
const ship = (type, x = 60, systemId = 'home') => ({ type, pos: { x, y: 0, z: 0 }, systemId });
assert.equal(hullProfile([], camera, options), 'tactical');
assert.equal(hullProfile([ship('frigate')], camera, options), 'small');
assert.equal(hullProfile([ship('capital')], camera, options), 'heavy');
assert.equal(hullProfile([ship('capital', 200), ship('capital', 30, 'remote'), { ...ship('capital', 30), dead: true }], camera, options), 'tactical');
assert.equal(hullProfile([], camera, { ...options, bridge: true }), 'bridge');
const quiet = quietPhrase(15, 0), combat = quietPhrase(15, .9);
assert(quiet.machinery > 0); assert.equal(combat.machinery, 0);
assert.notDeepEqual(quietPhrase(1, 0), quietPhrase(15, 0), 'Quiet score should change between four-bar phrases');
assert(quietPhrase(11, 0).motif < quietPhrase(1, 0).motif, 'Fourth bar needs breathing room');
console.log('Acoustics passed: deterministic bounded responses at four sample rates, local hull/bridge selection, quiet phrase variation and combat suppression.');
