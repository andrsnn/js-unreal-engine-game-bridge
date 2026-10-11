/**
 * Static contract for the sound pass: every cue id the game can name resolves to a real voice,
 * every bed loops, and the mix actually has the buses the pass depends on.
 *
 * Runs in plain node — the audio module is esbuild-bundled and handed a stub WebAudio graph, so this
 * needs no browser and no dev server. It proves resolution and wiring, never how anything sounds.
 *
 *   node tools/test-audio-map.mjs
 */
import {build} from 'esbuild';
import {runInThisContext} from 'node:vm';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';

const DIR = 'reports/audio-pass';
mkdirSync(DIR, {recursive: true});

// ---------------------------------------------------------------- stub host --
const param = (value = 0) => ({
  value,
  setValueAtTime() {return this;}, setTargetAtTime() {return this;},
  linearRampToValueAtTime() {return this;}, exponentialRampToValueAtTime() {return this;},
  cancelScheduledValues() {return this;},
});
const nodes = [];
function node(type, extra = {}) {
  const n = {type, outputs: [], gain: param(1), connect(to) {this.outputs.push(to); return to;}, disconnect() {}, ...extra};
  nodes.push(n);
  return n;
}
class StubContext {
  constructor() {this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = node('destination');}
  async resume() {this.state = 'running';}
  async suspend() {}
  createGain() {return node('gain', {gain: param(1)});}
  createBiquadFilter() {return node('biquad', {frequency: param(350), Q: param(1), type: 'lowpass'});}
  createStereoPanner() {return node('panner', {pan: param(0)});}
  createDelay() {return node('delay', {delayTime: param(0)});}
  createDynamicsCompressor() {
    return node('compressor', {threshold: param(-24), knee: param(30), ratio: param(12), attack: param(.003), release: param(.25)});
  }
  createOscillator() {return node('oscillator', {frequency: param(440), detune: param(0), start() {}, stop() {}});}
  createBufferSource() {
    return node('source', {buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1), start() {}, stop() {}, onended: null});
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({length: channels}, () => new Float32Array(length));
    return {numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: i => data[i]};
  }
  async decodeAudioData() {throw new Error('no recordings in the stub host');}
}
class StubMediaStreamDestination {}
const store = new Map();
const listeners = new Map();
globalThis.AudioContext = StubContext;
globalThis.AudioNode = class {};
globalThis.AudioBufferSourceNode = class {};
globalThis.OscillatorNode = class {};
globalThis.MediaStreamAudioDestinationNode = StubMediaStreamDestination;
globalThis.MutationObserver = class {observe() {} disconnect() {}};
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
const element = () => ({
  style: {cssText: '', setProperty() {}}, dataset: {}, className: '', textContent: '', innerHTML: '',
  hidden: false, children: [], classList: {add() {}, remove() {}, toggle() {}},
  appendChild(c) {this.children.push(c); return c;}, append() {}, remove() {}, focus() {},
  setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  closest: () => null, matches: () => false, contains: () => false,
});
globalThis.document = {
  body: element(), documentElement: element(), baseURI: 'http://localhost/',
  activeElement: null, hidden: false,
  createElement: () => element(),
  addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
  removeEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [],
};
globalThis.window = {
  setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id),
  setTimeout: (fn, ms) => setTimeout(fn, ms), addEventListener() {}, dispatchEvent() {},
  location: {search: ''}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
};
globalThis.performance ??= {now: () => Date.now()};
globalThis.fetch = async () => ({ok: false, arrayBuffer: async () => new ArrayBuffer(0)});
globalThis.Event = class {constructor(type) {this.type = type;}};

// ------------------------------------------------------------------ bundle ---
const bundle = await build({
  stdin: {
    contents: `
      import {gameAudio, CUES, CUE_IDS, BED_KINDS} from './src/core/audio';
      import {synthVoice} from './src/core/soundBank';
      globalThis.lab = {gameAudio, CUES, CUE_IDS, BED_KINDS, synthVoice};
    `,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  external: ['three', 'three-mesh-bvh'],
});
runInThisContext(bundle.outputFiles[0].text);
const {gameAudio, CUES, CUE_IDS, BED_KINDS, synthVoice} = globalThis.lab;

const checks = [];
const check = (name, pass, details) => {checks.push({name, pass, details}); if (!pass) console.error('FAIL ' + name, details ?? '');};

// ------------------------------------------------- 1 · every cue resolves ----
const RATE = 48000;
const voices = {};
for (const id of CUE_IDS) {
  const {kind} = CUES[id];
  const pcm = synthVoice(kind, 0, RATE);
  let peak = 0, power = 0;
  for (const x of pcm) {peak = Math.max(peak, Math.abs(x)); power += x * x;}
  voices[id] = {kind, samples: pcm.length, peak: +peak.toFixed(4), rms: +Math.sqrt(power / pcm.length).toFixed(5),
    finite: pcm.every(Number.isFinite), ends: pcm[0] === 0 && pcm.at(-1) === 0};
}
const broken = Object.entries(voices).filter(([, v]) => !v.finite || !(v.peak > .05) || !(v.rms > .001) || !v.ends);
check(`All ${CUE_IDS.length} cue ids resolve to a finite, audible, fade-terminated voice`, broken.length === 0, broken);

// The nine areas of the pass each have to own at least one id, or the pass is only half wired.
const AREAS = {
  'arrival warnings': ['arrival_nest', 'arrival_foundry', 'arrival_settlement', 'wave_contact'],
  missiles: ['missile_launch', 'missile_impact', 'missile_near', 'missile_warning'],
  'combat roll': ['roll_whip', 'roll_land', 'dodge_chime'],
  objectives: ['objective_done', 'objective_provoke'],
  'guardian and captain': ['boss_phase', 'captain_phase', 'boss_charge', 'boss_crash'],
  base: ['base_weld', 'base_radio', 'base_step'],
  interface: ['ui_focus', 'ui_confirm', 'ui_purchase', 'ui_reveal', 'ui_rebind'],
};
for (const [area, ids] of Object.entries(AREAS)) {
  const missing = ids.filter(id => !CUES[id]);
  check(`${area}: ${ids.length} cue ids present`, missing.length === 0, missing);
}
// Distinct voices, so two different beats never play the same sample.
const distinct = new Set(Object.values(AREAS).flat().map(id => CUES[id].kind));
check('Every pass cue has its own voice', distinct.size === Object.values(AREAS).flat().length,
  {voices: distinct.size, cues: Object.values(AREAS).flat().length});

// --------------------------------------------------- 2 · the mix is wired ----
await gameAudio.unlock();
gameAudio.setSettings({master: .7, music: 0, effects: .75, muted: false});
const snap = gameAudio.snapshot();
check('Snapshot publishes the cue and bed contract', Array.isArray(snap.cues) && snap.cues.length === CUE_IDS.length && snap.beds.length === BED_KINDS.length, {cues: snap.cues?.length, beds: snap.beds});
check('Ducking bus exists', snap.buses?.duck === true, snap.buses);
check('Alert bus exists (warnings and stings bypass the combat duck)', snap.buses?.alert === true, snap.buses);
check('Master limiter present', snap.buses?.limiter === true, snap.buses);
check('Bed bus present', snap.buses?.bed === true, snap.buses);
check('Nothing is ducked at rest', snap.ducking?.active === false && snap.ducking.depth === 1, snap.ducking);

// An alert cue must actually pull the combat bus down.
gameAudio.cue('arrival_nest');
const ducked = gameAudio.snapshot();
check('An arrival warning ducks the combat bus', ducked.ducking.active === true && ducked.ducking.depth < 1, ducked.ducking);
check('An ordinary cue is registered as an event', ducked.events['arrival_nest'] >= 1, ducked.events['arrival_nest']);

// Every cue id is callable and lands on the event log.
for (const id of CUE_IDS) gameAudio.cue(id);
const fired = gameAudio.snapshot();
const silent = CUE_IDS.filter(id => !(fired.events[id] >= 1));
check('Every cue id fires through cue()', silent.length === 0, silent);

// ------------------------------------------------------- 3 · beds loop ------
const bedReport = {};
for (const kind of BED_KINDS) {
  const seconds = kind === 'flight' ? .6 : kind === 'work' ? 1.5 : 6;
  const pcm = gameAudio.bedPcm(kind, RATE, seconds);
  let peak = 0, power = 0;
  for (const x of pcm) {peak = Math.max(peak, Math.abs(x)); power += x * x;}
  // A seamless bed has no step at the splice: the wrap sample sits close to the first sample.
  const seam = Math.abs(pcm[0] - pcm[pcm.length - 1]);
  bedReport[kind] = {seconds, samples: pcm.length, peak: +peak.toFixed(3), rms: +Math.sqrt(power / pcm.length).toFixed(4), seam: +seam.toFixed(4),
    finite: pcm.every(Number.isFinite)};
}
const badBeds = Object.entries(bedReport).filter(([, b]) => !b.finite || !(b.rms > .01) || b.peak > 1 || b.seam > .35);
check(`All ${BED_KINDS.length} beds are finite, audible, unclipped and loop without a step`, badBeds.length === 0, badBeds);

// The held-work loop and the missile motor open and retire on the loop bus.
gameAudio.objectiveWork('probe', .5, false);
gameAudio.missileFlight('probe-missile', 40, 90, .2);
const looping = gameAudio.snapshot();
check('Held work and missile flight open loop voices', looping.loopVoices >= 2 && looping.missilesTracked >= 1, {loops: looping.loopVoices, missiles: looping.missilesTracked});

// The place beds are driven by the scene (base) and by the surface scene (town / night).
const tick = () => new Promise(r => setTimeout(r, 90));
gameAudio.update('home', 'verdant'); await tick();
check('The base scene raises the hangar bed', gameAudio.snapshot().bedLevels.hangar > 0, gameAudio.snapshot().bedLevels);
gameAudio.update('planet', 'verdant'); gameAudio.surfaceAmbience(1, false); await tick();
const day = gameAudio.snapshot().bedLevels;
check('A settlement raises the town bed by day', day.town > 0 && day.night === 0 && day.hangar === 0, day);
gameAudio.surfaceAmbience(1, true); await tick();
const night = gameAudio.snapshot().bedLevels;
check('Night swaps the town bed for crickets', night.night > 0, night);
gameAudio.surfaceAmbience(0, false); gameAudio.update('space', 'verdant'); await tick();

// ---------------------------------------------------------------- report ----
const pass = checks.every(c => c.pass);
const report = {when: new Date().toISOString(), pass, checks, voices, beds: bedReport, snapshot: gameAudio.snapshot()};
writeFileSync(`${DIR}/audio-map.json`, JSON.stringify(report, null, 1));
for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}`);
console.log(`\n${checks.filter(c => c.pass).length}/${checks.length} checks · ${CUE_IDS.length} cue ids · ${BED_KINDS.length} beds · ${DIR}/audio-map.json`);
assert(pass, 'audio map contract failed');
process.exit(0);
