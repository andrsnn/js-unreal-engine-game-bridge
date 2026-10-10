import {host} from './host';
import {bufferOrigin} from './fetch';

/** Web Audio for the Unreal target. The game's mixer builds its graph unchanged; this tracks the
 *  graph and plays each started source in Unreal as a voice. A voice carries the source file (or
 *  PCM for buffers the game synthesizes), its loop flag, and the gain, playback rate, stereo pan
 *  and 3D position its path to the destination applies. Those are resampled every frame, so
 *  fades and automation follow the game. Oscillators and short scheduled envelopes are rendered
 *  to PCM here and sent once. */
const g = globalThis as Record<string, any>;

type Event = {type: 'set' | 'linear' | 'exp' | 'target' | 'curve'; time: number; value: number; tc?: number; curve?: Float32Array; duration?: number};
class Param {
  defaultValue: number; minValue = -3.4e38; maxValue = 3.4e38; automationRate = 'a-rate';
  private v: number; private events: Event[] = [];
  constructor(private ctx: Ctx, value = 0) { this.v = value; this.defaultValue = value; }
  get value() { return this.at(this.ctx.currentTime); }
  set value(x: number) { this.v = +x; this.events = []; }
  private add(e: Event) { this.events.push(e); this.events.sort((a, b) => a.time - b.time); return this; }
  setValueAtTime(value: number, time: number) { return this.add({type: 'set', time, value}); }
  linearRampToValueAtTime(value: number, time: number) { return this.add({type: 'linear', time, value}); }
  exponentialRampToValueAtTime(value: number, time: number) { return this.add({type: 'exp', time, value}); }
  setTargetAtTime(value: number, time: number, tc: number) { return this.add({type: 'target', time, value, tc}); }
  setValueCurveAtTime(curve: ArrayLike<number>, time: number, duration: number) { return this.add({type: 'curve', time, value: curve[curve.length - 1] ?? 0, curve: Float32Array.from(curve), duration}); }
  cancelScheduledValues(time: number) { this.v = this.at(time); this.events = this.events.filter(e => e.time < time); return this; }
  cancelAndHoldAtTime(time: number) { return this.cancelScheduledValues(time); }
  /** Value at time t, following the Web Audio automation rules closely enough for mixing. */
  at(t: number): number {
    let value = this.v, prevTime = 0;
    for (const e of this.events) {
      if (e.type === 'linear' || e.type === 'exp') {
        if (t >= e.time) { value = e.value; prevTime = e.time; continue; }
        const span = e.time - prevTime, k = span > 0 ? (t - prevTime) / span : 1;
        return e.type === 'linear' || value <= 0 || e.value <= 0 ? value + (e.value - value) * k : value * Math.pow(e.value / value, k);
      }
      if (t < e.time) break;
      if (e.type === 'set') value = e.value;
      else if (e.type === 'target') value = e.value + (value - e.value) * Math.exp(-(t - e.time) / Math.max(1e-4, e.tc ?? 0.1));
      else if (e.type === 'curve' && e.curve) { const k = Math.min(1, (t - e.time) / Math.max(1e-6, e.duration ?? 1)); value = e.curve[Math.min(e.curve.length - 1, Math.floor(k * (e.curve.length - 1)))]; }
      prevTime = e.time;
    }
    return value;
  }
  /** Latest time any automation event still changes the value. */
  end() { const last = this.events[this.events.length - 1]; return last ? last.time + (last.type === 'target' ? 5 * (last.tc ?? 0.1) : last.duration ?? 0) : 0; }
}

class Node {
  context: Ctx; numberOfInputs = 1; numberOfOutputs = 1; channelCount = 2; channelCountMode = 'max'; channelInterpretation = 'speakers';
  outputs = new Set<Node | Param>();
  kind: string;
  constructor(ctx: Ctx, kind: string, params: Record<string, number> = {}) {
    this.context = ctx; this.kind = kind;
    for (const [name, value] of Object.entries(params)) (this as Record<string, unknown>)[name] = new Param(ctx, value);
  }
  connect(target: Node | Param) { this.outputs.add(target); return target; }
  disconnect(target?: Node | Param) { if (target) this.outputs.delete(target); else this.outputs.clear(); }
  addEventListener() {} removeEventListener() {}
}
const p = (n: Node, name: string) => (n as unknown as Record<string, Param>)[name];

type Path = {gain: number; pan: number; position: number[] | null; refDistance: number; maxDistance: number; filterHz: number};
/** The strongest route from a node to the destination, multiplying gains on the way. */
function route(n: Node | Param, t: number, depth = 0): Path | null {
  if (!(n instanceof Node) || depth > 32) return null;
  if (n.kind === 'destination') return {gain: 1, pan: 0, position: null, refDistance: 1, maxDistance: 10000, filterHz: 22050};
  let best: Path | null = null;
  for (const next of n.outputs) { const r = route(next, t, depth + 1); if (r && (!best || r.gain > best.gain)) best = r; }
  if (!best) return null;
  if (n.kind === 'gain') best.gain *= Math.max(0, p(n, 'gain').at(t));
  else if (n.kind === 'stereo') best.pan = Math.max(-1, Math.min(1, p(n, 'pan').at(t)));
  else if (n.kind === 'panner') { const x = n as unknown as Record<string, any>; best.position = [p(n, 'positionX').at(t), p(n, 'positionY').at(t), p(n, 'positionZ').at(t)]; best.refDistance = x.refDistance; best.maxDistance = x.maxDistance; }
  else if (n.kind === 'filter' && (n as unknown as {type: string}).type === 'lowpass') best.filterHz = Math.min(best.filterHz, p(n, 'frequency').at(t));
  return best;
}

let voiceSerial = 0;
const voices = new Map<number, Source>();
let ops: Record<string, unknown>[] = [];

class AudioBufferImpl {
  __src?: string; __id = ++voiceSerial;
  private data: Float32Array[] = [];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {}
  get duration() { return this.length / this.sampleRate; }
  getChannelData(i: number) { return this.data[i] ??= new Float32Array(this.length); }
  copyToChannel(src: Float32Array, i: number, offset = 0) { this.getChannelData(i).set(src, offset); }
  copyFromChannel(dst: Float32Array, i: number, offset = 0) { dst.set(this.getChannelData(i).subarray(offset, offset + dst.length)); }
  hasData() { return this.data.some(Boolean); }
}

class Source extends Node {
  buffer: AudioBufferImpl | null = null; loop = false; loopStart = 0; loopEnd = 0; type = 'sine';
  onended: null | ((e: unknown) => void) = null; private ended: ((e: unknown) => void)[] = [];
  id = 0; startAt = -1; stopAt = Infinity; offset = 0; sent = false; last = '';
  start(when = 0, offset = 0, duration?: number) {
    if (this.id) return; this.id = ++voiceSerial;
    this.startAt = Math.max(when, this.context.currentTime); this.offset = offset;
    if (duration !== undefined) this.stopAt = this.startAt + duration;
    else if (this.buffer && !this.loop) this.stopAt = this.startAt + Math.max(0, this.buffer.duration - offset) / Math.max(0.01, p(this, 'playbackRate').at(this.startAt));
    voices.set(this.id, this);
  }
  stop(when = 0) { this.stopAt = Math.min(this.stopAt, Math.max(when, this.context.currentTime)); }
  addEventListener(type: string, fn: (e: unknown) => void) { if (type === 'ended') this.ended.push(fn); }
  removeEventListener(type: string, fn: (e: unknown) => void) { if (type === 'ended') this.ended = this.ended.filter(f => f !== fn); }
  finish() { voices.delete(this.id); if (this.sent) ops.push({op: 'stop', id: this.id}); const e = {type: 'ended', target: this}; this.onended?.(e); for (const f of this.ended) f(e); }
  setPeriodicWave() { this.type = 'custom'; }
}

/** Renders a short oscillator or synthesized-buffer voice through its gain envelope to PCM. */
function renderPcm(s: Source, path: Path, rate: number): Float32Array {
  const seconds = Math.min(10, Math.max(0.01, (Number.isFinite(s.stopAt) ? s.stopAt : s.startAt + 2) - s.startAt));
  const frames = Math.ceil(seconds * rate), out = new Float32Array(frames);
  const freq = p(s, 'frequency'), detune = p(s, 'detune');
  let phase = 0;
  const data = s.buffer?.getChannelData(0), playback = p(s, 'playbackRate');
  let read = s.offset * (s.buffer?.sampleRate ?? rate);
  for (let i = 0; i < frames; i++) {
    const t = s.startAt + i / rate;
    let v = 0;
    if (data) {
      const k = read | 0; v = data[s.loop ? k % data.length : k] ?? 0;
      read += (s.buffer!.sampleRate / rate) * (playback?.at(t) ?? 1);
    } else {
      const f = freq.at(t) * Math.pow(2, (detune?.at(t) ?? 0) / 1200);
      phase = (phase + f / rate) % 1;
      v = s.type === 'square' ? (phase < 0.5 ? 1 : -1) : s.type === 'sawtooth' ? 2 * phase - 1 : s.type === 'triangle' ? 1 - 4 * Math.abs(phase - 0.5) : Math.sin(phase * 2 * Math.PI);
    }
    out[i] = v * (path.gain > 0 ? envelope(s, t) : 0);
  }
  return out;
}
/** Gain automation along the voice's path, relative to the gain it is started with. */
function envelope(s: Source, t: number) { const r = route(s, t); return r ? r.gain : 0; }


/** Sends new voices, per-frame changes and ends. Called once per host frame. */
export function flushAudio(ctxTime: number) {
  for (const s of [...voices.values()]) {
    if (ctxTime >= s.stopAt) { s.finish(); continue; }
    if (ctxTime < s.startAt) continue;
    const path = route(s, ctxTime);
    if (!path) continue;
    const rate = p(s, 'playbackRate')?.at(ctxTime) ?? 1;
    const state = {gain: +path.gain.toFixed(4), rate: +rate.toFixed(4), pan: +path.pan.toFixed(3), position: path.position?.map(v => +v.toFixed(3)) ?? null, lowpass: Math.round(path.filterHz)};
    const sig = JSON.stringify(state);
    if (!s.sent) {
      s.sent = true; s.last = sig;
      const voice: Record<string, unknown> = {op: 'start', id: s.id, loop: s.loop, offset: s.offset, refDistance: path.refDistance, maxDistance: path.maxDistance, ...state};
      const file = s.buffer?.__src;
      if (file && !s.buffer!.hasData()) voice.src = file;
      else {
        // Oscillators and buffers the game filled itself become PCM, with the envelope baked in.
        const sampleRate = s.buffer?.sampleRate ?? 48000;
        const pcm = renderPcm(s, path, sampleRate);
        voice.pcm = {rate: sampleRate, frames: pcm.length}; voice.gain = 1; voice.loop = s.loop && !!s.buffer;
        host.audio?.pcm?.(s.id, pcm.buffer, sampleRate);
      }
      ops.push(voice);
    } else if (sig !== s.last && !(s.buffer?.hasData() ?? true)) { s.last = sig; ops.push({op: 'update', id: s.id, ...state}); }
  }
  for (const el of mediaElements) el.flush();
  if (ops.length) { host.audio?.voices(JSON.stringify(ops)); ops = []; }
}

/** Duration of an encoded Ogg (Vorbis/Opus) or WAV file; MP3 is estimated from its bitrate. */
function encodedDuration(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) { // RIFF WAVE
    let o = 12, byteRate = 0;
    while (o + 8 <= b.length) { const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]), len = dv.getUint32(o + 4, true);
      if (id === 'fmt ') byteRate = dv.getUint32(o + 16, true); if (id === 'data' && byteRate) return len / byteRate; o += 8 + len + (len & 1); }
    return 1;
  }
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) { // OggS
    let rate = 48000, preSkip = 0;
    const head = String.fromCharCode(...b.subarray(28, 36));
    if (head.startsWith('\x01vorbis')) rate = dv.getUint32(40, true); else if (head.startsWith('OpusHead')) preSkip = dv.getUint16(38, true);
    for (let o = b.length - 14; o >= 0; o--) if (b[o] === 0x4f && b[o + 1] === 0x67 && b[o + 2] === 0x67 && b[o + 3] === 0x53) {
      const granule = dv.getUint32(o + 6, true) + dv.getUint32(o + 10, true) * 4294967296; return Math.max(0.01, (granule - preSkip) / rate);
    }
  }
  return Math.max(0.05, b.length / 16000); // MP3 and others: about 128 kbit/s
}

class Ctx {
  state = 'running'; sampleRate = 48000; baseLatency = 0.01; outputLatency = 0.02; onstatechange: null | (() => void) = null;
  readonly destination: Node; readonly listener: Record<string, any>;
  private t0 = host.now();
  constructor() {
    this.destination = new Node(this, 'destination'); (this.destination as unknown as Record<string, number>).maxChannelCount = 2;
    const P = (v = 0) => new Param(this, v);
    this.listener = {positionX: P(), positionY: P(), positionZ: P(), forwardX: P(), forwardY: P(), forwardZ: P(-1), upX: P(), upY: P(1), upZ: P(),
      setPosition(x: number, y: number, z: number) { this.positionX.value = x; this.positionY.value = y; this.positionZ.value = z; }, setOrientation() {}};
    contexts.push(this);
  }
  get currentTime() { return (host.now() - this.t0) / 1000; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { return new Node(this, 'gain', {gain: 1}); }
  createBufferSource() { return new Source(this, 'source', {playbackRate: 1, detune: 0}); }
  createOscillator() { return new Source(this, 'source', {frequency: 440, detune: 0}); }
  createConstantSource() { return new Source(this, 'source', {offset: 1}); }
  createBiquadFilter() { return Object.assign(new Node(this, 'filter', {frequency: 350, Q: 1, gain: 0, detune: 0}), {type: 'lowpass', getFrequencyResponse() {}}); }
  createDelay() { return new Node(this, 'delay', {delayTime: 0}); }
  createDynamicsCompressor() { return Object.assign(new Node(this, 'compressor', {threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25}), {reduction: 0}); }
  createStereoPanner() { return new Node(this, 'stereo', {pan: 0}); }
  createPanner() {
    const n = new Node(this, 'panner', {positionX: 0, positionY: 0, positionZ: 0, orientationX: 1, orientationY: 0, orientationZ: 0});
    return Object.assign(n, {panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 1, maxDistance: 10000, rolloffFactor: 1, coneInnerAngle: 360, coneOuterAngle: 360, coneOuterGain: 0,
      setPosition(x: number, y: number, z: number) { p(n, 'positionX').value = x; p(n, 'positionY').value = y; p(n, 'positionZ').value = z; }, setOrientation() {}});
  }
  createConvolver() { return Object.assign(new Node(this, 'convolver'), {buffer: null, normalize: true}); }
  createWaveShaper() { return Object.assign(new Node(this, 'shaper'), {curve: null, oversample: 'none'}); }
  createAnalyser() { return Object.assign(new Node(this, 'analyser'), {fftSize: 2048, frequencyBinCount: 1024, minDecibels: -100, maxDecibels: -30, smoothingTimeConstant: 0.8,
    getByteFrequencyData(a: Uint8Array) { a.fill(0); }, getFloatFrequencyData(a: Float32Array) { a.fill(-100); }, getByteTimeDomainData(a: Uint8Array) { a.fill(128); }, getFloatTimeDomainData(a: Float32Array) { a.fill(0); }}); }
  createChannelSplitter() { return new Node(this, 'splitter'); }
  createChannelMerger() { return new Node(this, 'merger'); }
  createPeriodicWave() { return {}; }
  createMediaElementSource(el: MediaElement) { const n = new Node(this, 'media'); el.node = n; return n; }
  createMediaStreamDestination() { return Object.assign(new Node(this, 'stream'), {stream: {getTracks: () => []}}); }
  createBuffer(channels: number, length: number, rate: number) { return new AudioBufferImpl(channels, length, rate); }
  decodeAudioData(data: ArrayBuffer, ok?: (b: unknown) => void, _fail?: (e: unknown) => void) {
    const bytes = new Uint8Array(data);
    const b = new AudioBufferImpl(2, Math.max(1, Math.round(encodedDuration(bytes) * this.sampleRate)), this.sampleRate);
    const origin = bufferOrigin.get(data); b.__src = origin ? decodeURIComponent(new g.URL(origin, 'http://localhost/').pathname) : undefined;
    if (!b.__src) host.log('warn', 'decodeAudioData: buffer has no source file; it will play silent');
    ok?.(b); return Promise.resolve(b);
  }
  addEventListener() {} removeEventListener() {}
}
const contexts: Ctx[] = [];
/** Seconds on the audio clock (host time), for flushAudio. */
export const audioTime = () => contexts[0]?.currentTime ?? 0;

/** <audio> and new Audio(src): one looping or one-shot voice by file. */
const mediaElements = new Set<MediaElement>();
class MediaElement {
  src = ''; volume = 1; loop = false; muted = false; playbackRate = 1; currentTime = 0; paused = true; preload = 'auto'; readyState = 4; duration = NaN;
  node: Node | null = null; private id = 0; private last = ''; private listeners: Record<string, ((e: unknown) => void)[]> = {};
  onended: null | ((e: unknown) => void) = null;
  constructor(src?: string) { if (src) this.src = src; }
  play() { if (!this.id) { this.id = ++voiceSerial; this.last = ''; mediaElements.add(this); } this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; if (this.id) ops.push({op: 'stop', id: this.id}); this.id = 0; mediaElements.delete(this); }
  load() {} canPlayType() { return 'probably'; }
  // Attribute access as on an <audio> element; games clear src with removeAttribute('src') to release it.
  private attrs: Record<string, string> = {};
  setAttribute(name: string, value: string) { if (name === 'src') this.src = String(value); else if (name === 'loop' || name === 'muted') (this as Record<string, unknown>)[name] = true; else this.attrs[name] = String(value); }
  getAttribute(name: string) { return name === 'src' ? this.src || null : this.attrs[name] ?? null; }
  hasAttribute(name: string) { return this.getAttribute(name) !== null; }
  removeAttribute(name: string) { if (name === 'src') { this.pause(); this.src = ''; } else if (name === 'loop' || name === 'muted') (this as Record<string, unknown>)[name] = false; else delete this.attrs[name]; }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); if (type === 'canplaythrough' || type === 'loadeddata') setTimeout(() => fn({type, target: this}), 0); }
  removeEventListener(type: string, fn: (e: unknown) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn); }
  flush() {
    const gain = this.muted ? 0 : this.volume * (this.node ? route(this.node, audioTime())?.gain ?? 0 : 1);
    const state = JSON.stringify({gain: +gain.toFixed(4), rate: this.playbackRate});
    if (!this.last) ops.push({op: 'start', id: this.id, src: new g.URL(this.src, 'http://localhost/').pathname, loop: this.loop, offset: this.currentTime, gain, rate: this.playbackRate, pan: 0, position: null});
    else if (state !== this.last) ops.push({op: 'update', id: this.id, gain, rate: this.playbackRate});
    this.last = state;
  }
}

g.AudioContext = Ctx;
g.webkitAudioContext = Ctx;
g.OfflineAudioContext = class extends Ctx { constructor(_c?: number, public length = 0, rate = 48000) { super(); this.sampleRate = rate; } startRendering() { return Promise.resolve(this.createBuffer(2, this.length, this.sampleRate)); } };
g.AudioBuffer = AudioBufferImpl;
g.AudioNode = Node; g.GainNode = Node; g.AudioBufferSourceNode = Source; g.OscillatorNode = Source; g.AudioParam = Param;
g.Audio = MediaElement;
