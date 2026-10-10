/** JsGameBridge entry. Installs the browser environment, then boots the unchanged game entry that
 *  the build resolves as 'jsgb:game'. The host drives everything through `globalThis.__jsgb`. */
import './polyfills';
import {host} from './host';
import {pumpFrame, pendingTimers} from './timers';
import {setViewport} from './dom';
import './fetch';
import {flushAudio, audioTime} from './audio';
import './worker';
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
  input, ui: uiInput, viewport: setViewport, emit: emitEvent,
  click: clickElement, find: (what: string) => !!findElement(what),
  key: (code: string, how = 'press') => { if (how !== 'up') input.key('keydown', code); if (how !== 'down') input.key('keyup', code); return code; },
  pendingTimers, lastFrame, describeScene,
  get frames() { return frames; },
  get booted() { return booted; },
  get bootError() { return bootError; },
};

// Classic inline <script> blocks from index.html run first, in page order, as in a browser.
declare const __JSGB_INLINE__: string[];
for (const code of typeof __JSGB_INLINE__ === 'object' ? __JSGB_INLINE__ : []) {
  try { (0, eval)(code); } catch (e) { host.log('error', 'inline script: ' + (e instanceof Error ? e.stack : e)); }
}

import('jsgb:game')
  .then(() => { booted = true; host.log('log', 'game entry evaluated'); host.ready?.('game entry evaluated'); })
  .catch(error => { bootError = error instanceof Error ? error.stack ?? error.message : String(error); host.log('error', 'game entry failed: ' + bootError);
    g.dispatchEvent?.(Object.assign(new g.Event('error'), {error, message: String(error)})); });
