/** JsGameBridge entry. Installs the browser environment, then boots the unchanged game entry that
 *  the build resolves as 'jsgb:game'. The host drives everything through `globalThis.__jsgb`. */
import './polyfills';
import {host} from './host';
import {pumpFrame, pendingTimers} from './timers';
import {setViewport} from './dom';
import './fetch';
import {flushAudio, audioTime} from './audio';
import './worker';
import './text';
import {input} from './input';
import {publishUI, uiInput, clickElement, findElement} from './ui';
import {lastFrame} from './renderer';
import {exportFrame, describeScene, emitEvent} from './sceneExport';

const g = globalThis as Record<string, any>;
for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
  const kind = level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log';
  g.console ??= {};
  g.console[level] = (...args: unknown[]) => (typeof args[0] === 'string' && /^kPromise(Resolve|Reject)AfterResolved/.test(args[0])) ? undefined
    : host.log(kind, args.map(a => a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'object' ? safeJson(a) : String(a)).join(' '));
}
function safeJson(v: unknown) { try { return JSON.stringify(v)?.slice(0, 2000) ?? String(v); } catch { return String(v); } }

let frames = 0, booted = false, bootError = '';
g.__jsgb = {
  /** One host tick: due timers and promise jobs within budgetMs, the animation frame, then the
   *  scene, UI and audio go out to the host. */
  frame: async (budgetMs = 8) => {
    await pumpFrame(budgetMs); frames++;
    try { exportFrame(); } catch (e) { host.log('error', 'scene export: ' + (e instanceof Error ? e.stack : e)); }
    try { publishUI(); } catch (e) { host.log('error', 'ui publish: ' + (e instanceof Error ? e.stack : e)); }
    try { flushAudio(audioTime()); } catch (e) { host.log('error', 'audio: ' + (e instanceof Error ? e.stack : e)); }
  },
  input, ui: uiInput, publish: () => publishUI(0), viewport: setViewport, emit: emitEvent,
  click: clickElement, find: (what: string) => !!findElement(what),
  key: (code: string, how = 'press') => { if (how !== 'up') input.key('keydown', code); if (how !== 'down') input.key('keyup', code); return code; },
  pendingTimers, lastFrame, describeScene,
  get frames() { return frames; },
  get booted() { return booted; },
  get bootError() { return bootError; },
};

// A fixed seed (-JsgbSeed / conformance --seed) makes Math.random repeat, so a browser and an
// Unreal run of the same script build the same world.
// Scripts can re-seed later (seed <n>) so both runs share the moment the world is built.
function seedRandom(seed: number) {
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return seed;
}
if (host.seed) seedRandom(host.seed);
// A script's "seed <n>" re-seeds when the next click event starts, after pointer/mouse handlers,
// at the same point as the browser side of a conformance run (Tools/web.mjs).
g.__jsgb.seed = (seed: number) => { g.addEventListener('click', () => seedRandom(seed), {capture: true, once: true}); return seed; };

// Classic inline <script> blocks from index.html run first, in page order, as in a browser.
declare const __JSGB_INLINE__: string[];
for (const code of typeof __JSGB_INLINE__ === 'object' ? __JSGB_INLINE__ : []) {
  try { (0, eval)(code); } catch (e) { host.log('error', 'inline script: ' + (e instanceof Error ? e.stack : e)); }
}

import('jsgb:game')
  .then(() => { booted = true; host.log('log', 'game entry evaluated'); host.ready?.('game entry evaluated'); })
  .catch(error => { bootError = error instanceof Error ? error.stack ?? error.message : String(error); host.log('error', 'game entry failed: ' + bootError);
    g.dispatchEvent?.(Object.assign(new g.Event('error'), {error, message: String(error)})); });
