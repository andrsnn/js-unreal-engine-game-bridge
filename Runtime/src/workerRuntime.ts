/** The runtime inside a threaded Web Worker: its own V8 isolate on its own thread, as in a browser.
 *  The host (JsgbWorkers.cpp) provides __post, __log, __now, __readFile and __close, and drives the
 *  worker by calling __dispatch(bytes) for each message and __tick() for timers. Messages travel as
 *  bytes in the structured-clone subset of clone.ts. */
import {blobStore} from './polyfills';
import {encode, decode} from './clone';
import {Context2D, Path2DImpl, OffscreenCanvasImpl, ImageDataImpl, ImageBitmapImpl} from './canvas2d';
import {Headers, Response, Request, MIME} from './fetchCore';

type Native = {
  __post(bytes: ArrayBuffer): void; __log(level: string, text: string): void; __now(): number;
  __readFile(path: string): ArrayBuffer | null; __close(): void; __workerId(): number;
  __blobPut(url: string, bytes: ArrayBuffer, type: string): void; __blobGet(url: string): [ArrayBuffer, string] | null; __blobRevoke(url: string): void;
};
const g = globalThis as unknown as Record<string, any> & Native;
const native = {post: g.__post, log: g.__log, now: g.__now, readFile: g.__readFile, close: g.__close};
// Blob URLs this worker makes are readable by the page and other workers, and theirs by this one.
g.__jsgbBlobPrefix = `blob:jsgb/w${g.__workerId()}-`;
g.__jsgbBlobs = {
  put: (url: string, bytes: ArrayBuffer, type: string) => g.__blobPut(url, bytes, type),
  get: (url: string) => { const r = g.__blobGet(url); return r ? {bytes: r[0], type: r[1]} : null; },
  revoke: (url: string) => g.__blobRevoke(url),
};

type Listener = (e: {data: unknown}) => void;
const listeners: Record<string, Listener[]> = {};
let onmessage: Listener | null = null;
Object.defineProperty(g, 'onmessage', {get: () => onmessage, set: (f: Listener | null) => { onmessage = f; }, configurable: true});
g.addEventListener = (type: string, fn: Listener) => { (listeners[type] ??= []).push(fn); };
g.removeEventListener = (type: string, fn: Listener) => { listeners[type] = (listeners[type] ?? []).filter(f => f !== fn); };
g.postMessage = (data: unknown) => {
  const t0 = native.now();
  const bytes = encode(data);
  encodeMs += native.now() - t0;
  if (!bytes) throw Error('postMessage: this value cannot be copied between threads');
  native.post(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};
g.close = () => native.close();
g.self = g;
g.location = new g.URL('http://localhost/worker.js');
g.navigator ??= {userAgent: 'JsGameBridge-Unreal', language: 'en-US', hardwareConcurrency: 8};
g.performance ??= {};
g.performance.now = () => native.now();
const say = (level: string) => (...args: unknown[]) => native.log(level, args.map(a => a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'object' ? safe(a) : String(a)).join(' '));
const safe = (v: unknown) => { try { return JSON.stringify(v)?.slice(0, 2000) ?? String(v); } catch { return String(v); } };
g.console = {log: say('log'), info: say('log'), debug: say('log'), warn: say('warn'), error: say('error'), trace: say('log'), assert: () => undefined, time: () => undefined, timeEnd: () => undefined};

// Timers, run by the host loop through __tick.
type Timer = {id: number; due: number; every: number; fn: (...a: unknown[]) => void; args: unknown[]};
const timers = new Map<number, Timer>();
let nextTimer = 1;
const add = (fn: Timer['fn'], ms: number, args: unknown[], every: boolean) => { const id = nextTimer++; timers.set(id, {id, due: native.now() + Math.max(0, +ms || 0), every: every ? Math.max(1, +ms || 0) : -1, fn, args}); return id; };
g.setTimeout = (fn: Timer['fn'], ms?: number, ...args: unknown[]) => add(fn, ms ?? 0, args, false);
g.setInterval = (fn: Timer['fn'], ms?: number, ...args: unknown[]) => add(fn, ms ?? 0, args, true);
g.clearTimeout = g.clearInterval = (id: number) => { timers.delete(id); };
g.queueMicrotask ??= (fn: () => void) => { Promise.resolve().then(fn); };
const report = (e: unknown) => native.log('error', 'worker: ' + (e instanceof Error ? `${e.message}\n${e.stack}` : String(e)));

/** Runs due timers; returns milliseconds until the next one (or 50 when there is none). */
g.__tick = () => {
  const now = native.now();
  const due = [...timers.values()].filter(t => t.due <= now).sort((a, b) => a.due - b.due || a.id - b.id);
  for (const t of due) {
    if (!timers.has(t.id)) continue;
    if (t.every >= 0) t.due = now + t.every; else timers.delete(t.id);
    try { t.fn(...t.args); } catch (e) { report(e); }
  }
  let wait = 50;
  for (const t of timers.values()) wait = Math.min(wait, Math.max(0, t.due - native.now()));
  return wait;
};
let encodeMs = 0;
g.__dispatch = (bytes: ArrayBuffer) => {
  const t0 = native.now();
  const e = {data: decode(bytes)};
  const t1 = native.now(); encodeMs = 0;
  try { onmessage?.(e); } catch (err) { report(err); }
  for (const l of listeners.message ?? []) { try { l(e); } catch (err) { report(err); } }
  // A long message shows where its time went: copying it in, the worker's own code, copying the reply out.
  const total = native.now() - t0;
  if (total > 250) native.log('log', `message of ${bytes.byteLength} bytes: decode ${Math.round(t1 - t0)} ms, worker code ${Math.round(total - (t1 - t0) - encodeMs)} ms, encode replies ${Math.round(encodeMs)} ms`);
};

// Files the worker loads: importScripts, and fetch for its own assets (a transcoder, a wasm file).
const pathOf = (url: string) => decodeURIComponent(new g.URL(url, 'http://localhost/').pathname);
const bytesOf = (url: string): ArrayBuffer | null => {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(','), meta = url.slice(5, comma), body = url.slice(comma + 1);
    const text = meta.endsWith(';base64') ? g.atob(body) : decodeURIComponent(body);
    const out = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out.buffer;
  }
  if (url.startsWith('blob:')) { const b = blobStore.get(url) as {bytes?: Uint8Array} | undefined; return b?.bytes ? b.bytes.slice().buffer : null; }
  return native.readFile(pathOf(url));
};
g.importScripts = (...urls: string[]) => {
  for (const u of urls) { const b = bytesOf(u); if (!b) throw Error('importScripts: not found: ' + u); (0, eval)(new g.TextDecoder().decode(b)); }
};
// fetch reads the game's own files (and blob/data URLs); anything else answers 503, as on the page.
g.Headers ??= Headers; g.Response ??= Response; g.Request ??= Request;
g.fetch = async (input: string | {url: string}, init?: {method?: string}) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  const local = url.startsWith('blob:') || url.startsWith('data:') || new g.URL(url, 'http://localhost/').hostname === 'localhost';
  if (!local || (init?.method && init.method !== 'GET')) return new Response(null, 503, url);
  const b = bytesOf(url), ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return new Response(b, b ? 200 : 404, url, MIME[ext] ?? '');
};

// Workers draw with OffscreenCanvas (procedural textures, text atlases) and read the pixels back.
g.OffscreenCanvas = OffscreenCanvasImpl;
g.OffscreenCanvasRenderingContext2D = Context2D;
g.Path2D = Path2DImpl;
g.ImageData = ImageDataImpl;
g.ImageBitmap = ImageBitmapImpl;

/** Starts the worker's script in the global scope, as a classic worker. */
g.__start = (source: string, url: string) => {
  g.location = new g.URL(url && !url.startsWith('blob:') ? url : 'http://localhost/worker.js', 'http://localhost/');
  (0, eval)(source);
};
