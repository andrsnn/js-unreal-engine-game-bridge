/** JsGameBridge entry. Installs the browser environment, then boots the unchanged game entry that
 *  the build resolves as 'jsgb:game'. The host drives everything through `globalThis.__jsgb`. */
import {seedRandom} from './seed';
import './polyfills';
import {host} from './host';
import {pumpFrame, pendingTimers, pumpTiming, wallNow} from './timers';
import {setViewport} from './dom';
import './fetch';
import {flushAudio, audioTime} from './audio';
import './worker';
import './display';
import {refreshGraphics} from './graphics';
import './text';
import {input} from './input';
import {publishUI, uiInput, clickElement, findElement} from './ui';
import {lastFrame, post} from './renderer';
import {exportFrame, describeScene, emitEvent, objectById} from './sceneExport';

const g = globalThis as Record<string, any>;
for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
  const kind = level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log';
  g.console ??= {};
  g.console[level] = (...args: unknown[]) => (typeof args[0] === 'string' && /^kPromise(Resolve|Reject)AfterResolved/.test(args[0])) ? undefined
    : host.log(kind, args.map(a => a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'object' ? safeJson(a) : String(a)).join(' '));
}
function safeJson(v: unknown) { try { return JSON.stringify(v)?.slice(0, 2000) ?? String(v); } catch { return String(v); } }

let frames = 0, booted = false, bootError = '';
// Frame part totals (Date.now steps of 1 ms average out over 300 frames).
const parts = new Float64Array(6); let partFrames = 0;
g.__jsgb = {
  /** One host tick: due timers and promise jobs within budgetMs, the animation frame, then the
   *  scene, UI and audio go out to the host. */
  frame: async (budgetMs = 8) => {
    const t0 = wallNow();
    await pumpFrame(budgetMs); frames++;
    const t1 = wallNow();
    refreshGraphics();
    try { exportFrame(); } catch (e) { host.log('error', 'scene export: ' + (e instanceof Error ? e.stack : e)); }
    const t2 = wallNow();
    try { publishUI(); } catch (e) { host.log('error', 'ui publish: ' + (e instanceof Error ? e.stack : e)); }
    const t3 = wallNow();
    try { flushAudio(audioTime()); } catch (e) { host.log('error', 'audio: ' + (e instanceof Error ? e.stack : e)); }
    const t4 = wallNow();
    // Every 300 frames, the average time of each part of a frame, so the game's own work and the bridge's can be told apart.
    const p0 = pumpTiming;
    parts[0] += t1 - t0; parts[1] += p0.rafMs; parts[2] += t2 - t1; parts[3] += t3 - t2; parts[4] += t4 - t3; parts[5] += t4 - t0;
    if (booted && ++partFrames >= 300) {
      const f = (v: number) => (v / partFrames).toFixed(2);
      host.log('log', `js frame parts over ${partFrames} frames: whole ${f(parts[5])} ms = pump ${f(parts[0])} (animation frame ${f(parts[1])}) + scene export ${f(parts[2])} + ui ${f(parts[3])} + audio ${f(parts[4])}`);
      parts.fill(0); partFrames = 0;
    }
    // A JavaScript frame much longer than 60 FPS allows gets a breakdown in the log.
    if (booted && t4 - t0 > 30) {
      const p = pumpTiming;
      host.log('log', `slow js frame ${frames}: ${t4 - t0} ms = worker replies ${p.workersMs} (${p.workerReplies}) + timers ${p.timersMs} (${p.timerCalls} calls, slowest ${p.slowestMs} ms in ${p.slowest}) + animation frame ${p.rafMs} (${p.rafCalls} callbacks) + scene export ${t2 - t1} + ui ${t3 - t2} + audio ${t4 - t3}`);
    }
  },
  input, ui: uiInput, publish: () => publishUI(0), viewport: setViewport, emit: emitEvent,
  click: clickElement, find: (what: string) => !!findElement(what),
  key: (code: string, how = 'press') => { if (how !== 'up') input.key('keydown', code); if (how !== 'down') input.key('keyup', code); return code; },
  pendingTimers, lastFrame, post, describeScene, objectById,
  get frames() { return frames; },
  get booted() { return booted; },
  get bootError() { return bootError; },
};

// Scripts can re-seed later (seed <n>) so both runs share the moment the world is built.
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
  .then(() => import('jsgb:adapters')).catch(error => { if (booted) host.log('error', 'adapter failed: ' + (error instanceof Error ? error.stack : error)); else throw error; })
  .catch(error => { bootError = error instanceof Error ? error.stack ?? error.message : String(error); host.log('error', 'game entry failed: ' + bootError);
    g.dispatchEvent?.(Object.assign(new g.Event('error'), {error, message: String(error)})); });
