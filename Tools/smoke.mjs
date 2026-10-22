// Boots a JsGameBridge bundle in Node's V8 with the same host interface Puerts provides, and reports
// how far the game gets. Node's own web globals are removed first so the bundle installs the same
// environment it gets in Unreal. Script steps drive the game the way a player would:
//   <frame>: <js>        run JavaScript in the game at that frame. Helpers:
//     click('Button text' | 'css selector')   key('KeyW', 'down'|'up'|'press')   shot('name')
//     waitFor('Button text' | 'css selector')  (holds the script until it appears, up to 30 s)
import fs from 'node:fs';
import {shaderAssetName} from './cook-shaders.mjs';
import {Buffer} from 'node:buffer';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// The registry as the Unreal host loads it: registry.json, with overrides.json's rules added as assets (JsgbHost.cpp).
function registryWithOverrides(out) {
  const file = path.join(out, 'registry.json'), overrides = path.join(out, 'overrides.json');
  if (!fs.existsSync(overrides)) return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const reg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const rules = JSON.parse(fs.readFileSync(overrides, 'utf8')).overrides ?? [];
  reg.assets = {...reg.assets};
  for (const r of rules) if (r?.name) reg.assets['override:' + r.name] = r;
  reg.overrides = rules;
  return JSON.stringify(reg);
}

export async function smoke(game, {frames = 600, script, search = '', verbose = false, prepareShaders = false, captureScript} = {}) {
  const publication = JSON.parse(fs.readFileSync(path.join(game.out, 'publication.json'), 'utf8'));
  const t0 = performance.now(), nativeNow = performance.now.bind(performance), nodeTimeout = setTimeout;
  const print = console.log.bind(console);
  const stats = {files: 0, missing: new Set(), geometries: 0, geometryMB: 0, materials: 0, textures: 0, frames: 0, records: {}, lastFloats: 0,
    errors: 0, warns: 0, uiPublishes: 0, uiBytes: 0, voices: 0, voiceFiles: new Set(), pcmVoices: 0, events: 0, unsupported: new Set()};
  const logs = [], seen = new Set(), storage = new Map(), shaderBodies = new Map(), nativeCoverage = {};
  const shaderStore = path.join(game.out, 'jsgb-store');
  const storeFile = k => 'shader-' + createHash('md5').update(Buffer.from(k, 'latin1')).digest('hex') + '.json';
  if (prepareShaders) globalThis.__jsgbPackagingMaterials = new Set();
  let lastUI = '';
  const host = {
    shaderPreparation: prepareShaders,
    search,
    now: () => nativeNow() - t0,
    trace: process.env.JSGB_TRACE === '1',
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
    storage: {load: k => {
      if (storage.has(k)) return storage.get(k);
      const f = path.join(shaderStore, storeFile(k));
      return k.startsWith('jsgb-translated-') && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    }, save: (k, v) => {
      storage.set(k, v);
      if (prepareShaders && k.startsWith('jsgb-translated-')) {
        fs.mkdirSync(shaderStore, {recursive: true}); fs.writeFileSync(path.join(shaderStore, storeFile(k)), v);
      }
    }},
    registry: registryWithOverrides(game.out),
    sink: {
      geometry(id, pos, nrm, uv, col, cs, idx) { stats.geometries++; stats.geometryMB += (pos.byteLength + (nrm?.byteLength ?? 0) + (uv?.byteLength ?? 0) + (col?.byteLength ?? 0) + (idx?.byteLength ?? 0)) / 1e6; },
      releaseGeometry() {},
      material(id, json) {
        stats.materials++;
        if (prepareShaders) {
          const m = JSON.parse(json);
          if (m.custom) {
            const name = shaderAssetName(m);
            const shader = shaderBodies.get(m.custom);
            if (!shader) throw Error(`Shader ${m.custom} is not ready; include its view in captureScripts and package again.`);
            nativeCoverage[name] = {shader: m.custom, sha256: createHash('sha256').update(shader).digest('hex'), body: JSON.parse(shader)};
          }
        }
      },
      texture() { stats.textures++; },
      frame(f, count) { stats.frames++; stats.lastFloats = count; lastFrame = new Float32Array(f, 0, count).slice(); },
      events(json) { stats.events += JSON.parse(json).length; },
      shader(key, json) { shaderBodies.set(key, json); stats.shaders = (stats.shaders ?? 0) + 1; fs.mkdirSync(path.join(game.out, 'shaders'), {recursive: true}); const t = JSON.parse(json); fs.writeFileSync(path.join(game.out, 'shaders', key + '.hlsl'), t.hlsl); },
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
  const captureSteps = (captureScript ? fs.readFileSync(captureScript, 'utf8') : '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const m = /^(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(l); return {time: +m[1] * 1000, verb: m[2], arg: m[3] ?? ''};
  });
  let captureWaiting = null, captureWaitStarted = 0;
  let captureStarted = null;
  const captureBootDeadline = host.now() + 180000;
  const captureEnd = captureSteps.length ? Math.max(...captureSteps.map(s => s.time)) + 2000 : 5000;
  const pending = [...steps].sort((a, b) => a.frame - b.frame);
  let frame = 0;
  for (; captureScript ? (captureStarted === null || captureWaiting ? host.now() < captureBootDeadline + captureEnd : host.now() - captureStarted < captureEnd) : frame < frames; frame++) {
    if (captureScript && jsgb.booted) {
      captureStarted ??= host.now();
      if (captureWaiting) {
        const found = find(captureWaiting.arg.replace(/^['"]|['"]$/g, ''));
        if (captureWaiting.verb === 'gone' ? !found : found) { captureStarted += host.now() - captureWaitStarted; captureWaiting = null; }
      }
      while (!captureWaiting && captureSteps.length && captureSteps[0].time <= host.now() - captureStarted) {
        const s = captureSteps.shift();
        if (s.verb === 'wait' || s.verb === 'gone') { captureWaiting = s; captureWaitStarted = host.now(); break; }
        if (s.verb === 'click') g.click((0, eval)(s.arg));
        else if (s.verb === 'key') (0, eval)('key(' + s.arg + ')');
        else if (s.verb === 'eval') (0, eval)(s.arg);
      }
    }
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
  let shaderCoverage = null;
  if (prepareShaders) {
    const deadline = nativeNow() + 60000;
    do {
      shaderCoverage = g.__jsgbPrepareMaterials();
      if (!shaderCoverage.pending.length) break;
      await jsgb.frame(12); await new Promise(r => nodeTimeout(r, 1));
    } while (nativeNow() < deadline);
    if (!jsgb.booted) shaderCoverage.pending.push('game startup');
    if (captureWaiting) shaderCoverage.pending.push('view ' + captureWaiting.arg);
    fs.writeFileSync(path.join(game.out, 'smoke.log'), logs.join('\n'));
    fs.writeFileSync(path.join(game.out, 'smoke-ui.html'), lastUI);
    if (shaderFailures.length) {
      fs.mkdirSync(path.join(game.out, 'shaders'), {recursive: true});
      for (const f of shaderFailures) fs.writeFileSync(path.join(game.out, 'shaders', `${f.key}.${f.label}.failed.txt`), `${f.glsl}\n\n${f.out}`);
    }
    const missing = [...shaderCoverage.pending, ...shaderCoverage.failed];
    if (missing.length) throw Error(`Shader ${missing[0]} is not ready; open its view in the game's captureScripts and fix any shader error before packaging.`);
    if (stats.errors) throw Error(`Shader view capture failed; fix the game errors in smoke.log before packaging.`);
  }
  const scene = jsgb.describeScene();
  const report = {game: game.id, sourceCommit: publication.sourceCommit, bundleSHA256: publication.bundleSHA256, frames: frame, seconds: +(host.now() / 1000).toFixed(1), booted: jsgb.booted, bootError: jsgb.bootError,
    shaderCoverage, ...stats, geometryMB: +stats.geometryMB.toFixed(1), missing: [...stats.missing].slice(0, 30), missingCount: stats.missing.size, voiceFiles: [...stats.voiceFiles].slice(0, 30), unsupported: [...stats.unsupported], scene};
  Object.assign(globalThis, nodeGlobals);
  for (const [o, k, d] of saved) if (d) Object.defineProperty(o, k, d);
  if (shaderFailures.length) { fs.mkdirSync(path.join(game.out, 'shaders'), {recursive: true}); for (const f of shaderFailures) fs.writeFileSync(path.join(game.out, 'shaders', `${f.key}.${f.label}.failed.txt`), `${f.glsl}\n\n==== output ====\n${f.out}`); }
  fs.writeFileSync(path.join(game.out, 'smoke.log'), logs.join('\n'));
  if (prepareShaders) fs.writeFileSync(path.join(game.out, 'native-shader-coverage.json'), JSON.stringify(nativeCoverage, null, 1));
  fs.writeFileSync(path.join(game.out, 'smoke-report.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(game.out, 'smoke-ui.html'), lastUI);
  print(JSON.stringify(report).slice(0, 3000));
  return report;
}
