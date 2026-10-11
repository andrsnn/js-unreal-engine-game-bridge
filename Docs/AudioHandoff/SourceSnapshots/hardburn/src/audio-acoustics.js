// Four finite, deterministic shipboard conduction responses. Early taps are
// damped metal/compartment reflections, never an outdoor sound-speed delay.
export const HULL_PROFILES = {
 tactical: { seconds: .10, decay: 54, cutoff: 1000, wet: .042, taps: [.008, .019, .036] },
 small: { seconds: .16, decay: 36, cutoff: 2600, wet: .09, taps: [.006, .015, .028, .049] },
 heavy: { seconds: .32, decay: 20, cutoff: 1500, wet: .115, taps: [.009, .024, .057, .091] },
 bridge: { seconds: .23, decay: 28, cutoff: 1900, wet: .14, taps: [.004, .012, .026, .041, .066] },
};

export function hullImpulse(profile, sampleRate) {
 const spec = HULL_PROFILES[profile];
 if (!spec) throw Error('Unknown hull profile');
 const channels = [];
 let seed = 19147 + Object.keys(HULL_PROFILES).indexOf(profile) * 173;
 for (let channel = 0; channel < 2; channel++) {
  const data = new Float32Array(Math.ceil(sampleRate * spec.seconds)); let smoothed = 0;
  for (let i = 0; i < data.length; i++) {
   seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
   smoothed += ((seed / 4294967296 * 2 - 1) - smoothed) * .13;
   data[i] = smoothed * Math.exp(-i / sampleRate * spec.decay);
  }
  for (let i = 0; i < spec.taps.length; i++) {
   const index = Math.round((spec.taps[i] + channel * .00031) * sampleRate);
   if (index < data.length) data[index] += .42 * Math.exp(-i * .43) * (i % 2 ? -.7 : 1);
  }
  // Sample-rate-independent energy bounds keep normalize=false predictable.
  let energy = 0; for (const value of data) energy += value * value;
  const scale = Math.sqrt(.42 / Math.max(.001, energy));
  for (let i = 0; i < data.length; i++) data[i] *= scale;
  channels.push(data);
 }
 return channels;
}

export function hullProfile(ships, camera, { bridge, audible }) {
 if (bridge) return 'bridge';
 let nearest = null, distance = 150 ** 2;
 for (const ship of ships) {
  if (ship.dead || ship.campaignUnit?.transit || !audible(ship.systemId)) continue;
  const x = ship.pos.x - camera.x, y = ship.pos.y - camera.y, z = ship.pos.z - camera.z, squared = x * x + y * y + z * z;
  if (squared < distance) { nearest = ship; distance = squared; }
 }
 return nearest ? ['capital', 'carrier', 'cruiser', 'station'].includes(nearest.type) ? 'heavy' : 'small' : 'tactical';
}

export function quietPhrase(seconds, intensity) {
 const beat = 60 / 72, bar = Math.floor(Math.max(0, seconds) / (beat * 4)), phrase = Math.floor(bar / 4) % 4;
 const quiet = Math.max(0, 1 - intensity / .5);
 // Alternate sparse bell, machine pulse and a breathing rest every fourth bar.
 const space = bar % 4 === 3 ? .32 : 1;
 return { phrase, motif: (phrase % 2 ? .44 : .84) * space,
  machinery: (phrase % 2 ? .72 : .26) * space * quiet };
}
