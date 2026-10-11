import {host} from './host';
import {pollWorkers} from './worker';
import {frameCount} from './frameCount';

/** Timers and animation frames driven by the host's tick, so the game advances only when Unreal
 *  steps it. `pumpFrame` runs everything that is due, yielding to promise jobs between batches. */
type Timer = {id: number; due: number; fn: (...a: unknown[]) => void; args: unknown[]; every: number};
const timers = new Map<number, Timer>();
let nextId = 1;
let frameCallbacks: Array<[number, FrameRequestCallback]> = [];

const g = globalThis as Record<string, unknown>;
const perf = (g.performance ??= {}) as Record<string, unknown>;
perf.now = () => host.now();
perf.timeOrigin ??= Date.now() - host.now();
/** Wall-clock milliseconds, for timing the bridge itself (Date.now may follow the game clock). */
export const wallNow: () => number = Date.now.bind(Date);
/** Time spent in the last pumpFrame: timers, the slowest timer callback, and animation-frame callbacks. */
export const pumpTiming = {workersMs: 0, workerReplies: 0, timersMs: 0, timerCalls: 0, slowestMs: 0, slowest: '', rafMs: 0, rafCalls: 0};
// With stepped game time, Date.now follows the same clock, as the browser capture does.
if (host.fixedStepMs) { const origin = perf.timeOrigin as number; Date.now = () => Math.floor(origin + host.now()); }
for (const m of ['mark', 'measure', 'clearMarks', 'clearMeasures']) perf[m] ??= () => undefined;
perf.getEntriesByName ??= () => []; perf.getEntriesByType ??= () => []; perf.getEntries ??= () => [];
perf.memory ??= {usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 4e9};
g.PerformanceObserver ??= class { observe() {} disconnect() {} takeRecords() { return []; } static supportedEntryTypes = []; };
g.setTimeout = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
  const id = nextId++; timers.set(id, {id, due: host.now() + Math.max(0, +ms || 0), fn, args, every: -1}); return id;
};
g.setInterval = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
  const id = nextId++, every = Math.max(1, +ms || 0); timers.set(id, {id, due: host.now() + every, fn, args, every}); return id;
};
g.clearTimeout = g.clearInterval = (id: number) => { timers.delete(id); };
g.setImmediate = (fn: () => void) => (g.setTimeout as (f: () => void) => number)(fn);
g.queueMicrotask ??= (fn: () => void) => { void Promise.resolve().then(fn); };
g.requestAnimationFrame = (fn: FrameRequestCallback) => { const id = nextId++; frameCallbacks.push([id, fn]); return id; };
g.cancelAnimationFrame = (id: number) => { frameCallbacks = frameCallbacks.filter(([i]) => i !== id); };
g.requestIdleCallback = (fn: (d: {timeRemaining(): number; didTimeout: boolean}) => void) =>
  (g.setTimeout as (f: () => void, ms: number) => number)(() => fn({timeRemaining: () => 8, didTimeout: false}), 1);
g.cancelIdleCallback = g.clearTimeout;

function report(error: unknown) {
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  host.log('error', 'Uncaught ' + text);
}

const yieldJobs = () => new Promise<void>(resolve => resolve());

/** Runs due timers (several passes, so 0 ms chains progress within one tick) and then one round
 *  of animation-frame callbacks. `budgetMs` bounds the timer passes. */
export async function pumpFrame(budgetMs: number): Promise<void> {
  const pollStart = wallNow();
  pumpTiming.workerReplies = pollWorkers();
  pumpTiming.workersMs = wallNow() - pollStart;
  const start = host.now(), wallStart = wallNow();
  pumpTiming.timerCalls = 0; pumpTiming.slowestMs = 0; pumpTiming.slowest = '';
  for (let pass = 0; pass < 200; pass++) {
    const now = host.now();
    const due = [...timers.values()].filter(t => t.due <= now).sort((a, b) => a.due - b.due || a.id - b.id);
    if (!due.length) { await yieldJobs(); if (pass > 0 && ![...timers.values()].some(t => t.due <= host.now())) break; continue; }
    for (const t of due) {
      if (!timers.has(t.id)) continue;
      if (t.every >= 0) t.due = now + t.every; else timers.delete(t.id);
      const t0 = wallNow();
      try { t.fn(...t.args); } catch (e) { report(e); }
      const took = wallNow() - t0; pumpTiming.timerCalls++;
      if (took > pumpTiming.slowestMs) { pumpTiming.slowestMs = took; pumpTiming.slowest = (t.fn as {name?: string}).name || '(anonymous)'; }
    }
    await yieldJobs();
    if (host.now() - start > budgetMs) break;
  }
  const rafStart = wallNow();
  pumpTiming.timersMs = rafStart - wallStart;
  const run = frameCallbacks; frameCallbacks = [];
  frameCount.animation++;
  const ts = host.now();
  for (const [, fn] of run) { try { fn(ts); } catch (e) { report(e); } }
  await yieldJobs();
  pumpTiming.rafMs = wallNow() - rafStart; pumpTiming.rafCalls = run.length;
}

export const pendingTimers = () => timers.size;

