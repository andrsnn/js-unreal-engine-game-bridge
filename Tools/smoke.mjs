// Boots a JsGameBridge bundle in Node's V8 with the same host interface Puerts provides, and reports
// how far the game gets. Node's own web globals are removed first so the bundle installs the same
// environment it gets in Unreal. Script steps drive the game the way a player would:
//   <frame>: <js>        run JavaScript in the game at that frame. Helpers:
//     click('Button text' | 'css selector')   key('KeyW', 'down'|'up'|'press')   shot('name')
//     waitFor('Button text' | 'css selector')  (holds the script until it appears, up to 30 s)
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function smoke(game, {frames = 600, script, search = '', verbose = false} = {}) {
  const publication = JSON.parse(fs.readFileSync(path.join(game.out, 'publication.json'), 'utf8'));
  const t0 = performance.now(), nativeNow = performance.now.bind(performance), nodeTimeout = setTimeout;
  const print = console.log.bind(console);
  const stats = {files: 0, missing: new Set(), geometries: 0, geometryMB: 0, materials: 0, textures: 0, frames: 0, records: {}, lastFloats: 0,
    errors: 0, warns: 0, uiPublishes: 0, uiBytes: 0, voices: 0, voiceFiles: new Set(), pcmVoices: 0, events: 0, unsupported: new Set()};
  const logs = [], seen = new Set(), storage = new Map();
  let lastUI = '';
  const host = {
    search,
    now: () => nativeNow() - t0,
    readFile(p) {
      const file = game.publicRoots.map(r => path.join(r, p)).find(f => fs.existsSync(f) && fs.statSync(f).isFile());
      if (!file) { stats.missing.add(p); return null; }
      const b = fs.readFileSync(file); stats.files++;
      const out = new Uint8Array(b.length); out.set(b); return out.buffer;
    },
    log(level, text) {
      if (level === 'error') stats.errors++; if (level === 'warn') stats.warns++;
      logs.push(`[${(host.now() / 1000).toFixed(2)}] ${level} ${text}`);
      const key = level + text.slice(0, 160);
      if ((level !== 'log' || verbose) && !seen.has(key)) { seen.add(key); print(level, text.slice(0, 1500)); }
    },
    reload() { print('reload requested'); },
    storage: {load: k => storage.get(k) ?? null, save: (k, v) => storage.set(k, v)},
    registry: fs.existsSync(path.join(game.out, 'registry.json')) ? fs.readFileSync(path.join(game.out, 'registry.json'), 'utf8') : '',
    sink: {
      geometry(id, pos, nrm, uv, col, cs, idx) { stats.geometries++; stats.geometryMB += (pos.byteLength + (nrm?.byteLength ?? 0) + (uv?.byteLength ?? 0) + (col?.byteLength ?? 0) + (idx?.byteLength ?? 0)) / 1e6; },
      releaseGeometry() {},
      material() { stats.materials++; },
      texture() { stats.textures++; },
      frame(f, count) { stats.frames++; stats.lastFloats = count; lastFrame = new Float32Array(f, 0, count).slice(); },
      events(json) { stats.events += JSON.parse(json).length; },
      shader(key, json) { stats.shaders = (stats.shaders ?? 0) + 1; fs.mkdirSync(path.join(game.out, 'shaders'), {recursive: true}); const t = JSON.parse(json); fs.writeFileSync(path.join(game.out, 'shaders', key + '.hlsl'), t.hlsl); },
    },
    ui: {publish(html) { stats.uiPublishes++; stats.uiBytes = html.length; lastUI = html; }},
    audio: {
      voices(json) { for (const v of JSON.parse(json)) if (v.op === 'start') { stats.voices++; if (v.src) stats.voiceFiles.add(v.src); } },
      pcm() { stats.pcmVoices++; },
    },
  };
  let lastFrame = null;
  for (const k of ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'structuredClone', 'Blob', 'fetch', 'Response', 'Headers', 'Request',
    'AbortController', 'AbortSignal', 'navigator', 'performance', 'atob', 'btoa', 'Event', 'EventTarget', 'CustomEvent', 'MessageEvent', 'DOMException',
    'BroadcastChannel', 'MessageChannel', 'MessagePort', 'WebSocket', 'File', 'FormData', 'CompressionStream', 'DecompressionStream', 'ReadableStream',
    'WritableStream', 'TransformStream', 'crypto', 'Navigator', 'Performance', 'localStorage', 'sessionStorage', 'Storage'])
    try { delete globalThis[k]; } catch { /* ignore */ }
  // Puerts has no Node: hide process/Buffer so libraries (Emscripten loaders) take their browser path.
  const nodeGlobals = {process: globalThis.process, Buffer: globalThis.Buffer, global: globalThis.global, setImmediate: globalThis.setImmediate};
  for (const k of Object.keys(nodeGlobals)) delete globalThis[k];
  globalThis.__jsgbHost = host;
  const shaderFailures = globalThis.__jsgbShaderFailures = [];
  // Remove built-ins newer than Puerts' V8 (9.4) so the runtime's own versions are what runs here.
  const removed = [[Array.prototype, ['toSorted', 'toReversed', 'toSpliced', 'with', 'findLast', 'findLastIndex']], [Object, ['hasOwn', 'groupBy']], [Map, ['groupBy']],
    [Promise, ['withResolvers']], [Array, ['fromAsync']], [String.prototype, ['isWellFormed', 'toWellFormed']],
    [Set.prototype, ['union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom']], [globalThis, ['Intl']]];
  const saved = removed.flatMap(([o, keys]) => keys.map(k => [o, k, Object.getOwnPropertyDescriptor(o, k)]));
  for (const [o, k] of saved) delete o[k];
  const onRejection = e => host.log('error', 'unhandled rejection: ' + (e?.stack ?? e));
  nodeGlobals.process.on('unhandledRejection', onRejection);
  nodeGlobals.process.on('uncaughtException', onRejection);
  const tl = nativeNow();
  await import(pathToFileURL(publication.bundle).href + '?t=' + Date.now());
  print(`bundle evaluated in ${(nativeNow() - tl).toFixed(0)} ms`);
  const g = globalThis, jsgb = g.__jsgb;
  const find = what => jsgb.find(what);
  g.click = what => jsgb.click(what);
  g.key = (code, how) => jsgb.key(code, how);
  g.shot = name => fs.writeFileSync(path.join(game.out, `smoke-${name}.html`), lastUI);
  const steps = (script ? fs.readFileSync(script, 'utf8') : '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf(':'); return {frame: +l.slice(0, i), cmd: l.slice(i + 1).trim()}; });
  let waiting = null, waitStart = 0;
  const pending = [...steps].sort((a, b) => a.frame - b.frame);
  let frame = 0;
  for (; frame < frames; frame++) {
    await jsgb.frame(12);
    if (waiting) { if (find(waiting)) { print(`frame ${frame}: found ${waiting}`); waiting = null; } else if (host.now() - waitStart > 30000) { host.log('error', 'waitFor timed out: ' + waiting); waiting = null; } }
    while (!waiting && pending.length && pending[0].frame <= frame) {
      const s = pending.shift();
      const wait = /^waitFor\((['"`])(.+)\1\)$/.exec(s.cmd);
      if (wait) { waiting = wait[2]; waitStart = host.now(); print(`frame ${frame}: waiting for ${waiting}`); continue; }
      try { const r = (0, eval)(s.cmd); print(`frame ${frame}: ${s.cmd} -> ${typeof r === 'object' ? JSON.stringify(r)?.slice(0, 300) : r}`); }
      catch (e) { host.log('error', `script ${s.cmd}: ${e.stack ?? e}`); }
    }
    if (frame % 120 === 0) print(`frame ${frame} t=${(host.now() / 1000).toFixed(1)}s booted=${jsgb.booted} timers=${jsgb.pendingTimers()} geo=${stats.geometries} mat=${stats.materials} tex=${stats.textures} floats=${stats.lastFloats} ui=${stats.uiPublishes} voices=${stats.voices}`);
    await new Promise(r => nodeTimeout(r, 1));
  }
  const scene = jsgb.describeScene();
  const report = {game: game.id, sourceCommit: publication.sourceCommit, bundleSHA256: publication.bundleSHA256, frames: frame, seconds: +(host.now() / 1000).toFixed(1), booted: jsgb.booted, bootError: jsgb.bootError,
    ...stats, geometryMB: +stats.geometryMB.toFixed(1), missing: [...stats.missing].slice(0, 30), missingCount: stats.missing.size, voiceFiles: [...stats.voiceFiles].slice(0, 30), unsupported: [...stats.unsupported], scene};
  Object.assign(globalThis, nodeGlobals);
  for (const [o, k, d] of saved) if (d) Object.defineProperty(o, k, d);
  if (shaderFailures.length) { fs.mkdirSync(path.join(game.out, 'shaders'), {recursive: true}); for (const f of shaderFailures) fs.writeFileSync(path.join(game.out, 'shaders', `${f.key}.${f.label}.failed.txt`), `${f.glsl}\n\n==== output ====\n${f.out}`); }
  fs.writeFileSync(path.join(game.out, 'smoke.log'), logs.join('\n'));
  fs.writeFileSync(path.join(game.out, 'smoke-report.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(game.out, 'smoke-ui.html'), lastUI);
  print(JSON.stringify(report).slice(0, 3000));
  return report;
}
