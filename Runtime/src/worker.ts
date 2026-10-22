import {host} from './host';
import {blobStore} from './polyfills';
import {resolveAssetPath} from './dom';
import {encode, decode, hashBytes} from './clone';
/** Web Workers run in the same V8 context on the Unreal target. Each worker module is bundled
 *  separately at build time; its code runs with a private `self`, and messages are delivered on
 *  later timer turns just as a real worker would deliver them. */
type Listener = (e: {data: unknown}) => void;
/** Hot reload cache counters (inspect with __jsgbWorkerCache). */
const stats = {hits: 0, misses: 0, stored: 0, unencodable: 0, asyncWorkers: 0};
(globalThis as Record<string, unknown>).__jsgbWorkerCache = stats;
const asyncMark = (source: string) => 'jsgb-worker-async:' + source;

class WorkerScope {
  onmessage: Listener | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private listeners: Listener[] = [];
  constructor(private owner: UnrealWorker) {}
  postMessage(data: unknown) { this.owner.deliverToOwner(data); }
  addEventListener(type: string, fn: Listener) { if (type === 'message') this.listeners.push(fn); }
  removeEventListener(type: string, fn: Listener) { this.listeners = this.listeners.filter(l => l !== fn); }
  close() { this.owner.terminate(); }
  dispatch(data: unknown) { const e = {data}; this.onmessage?.(e); for (const l of this.listeners) l(e); }
}

// A worker's global scope falls back to the page's globals (Uint8Array, WebAssembly, fetch...),
// which Emscripten's embind looks up through globalThis.
Object.setPrototypeOf(WorkerScope.prototype, globalThis);

export class UnrealWorker {
  onmessage: Listener | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  private listeners: Record<string, Listener[]> = {};
  private scope = new WorkerScope(this);
  private dead = false;
  readonly name: string;
  // Hot reload cache: a worker's replies are stored under the hash of its source and the message,
  // so a reload that sends the same message gets the replies without running the work again. Asset
  // loads finish in a different order on each boot, so the key does not depend on earlier messages.
  // Messages answered from the cache still run, silently, before the next cache miss, so a worker
  // that keeps state sees every message in order; no message runs more than once. Only workers
  // that answer while handling the message are cached: one that answers later (after awaiting
  // something) is marked and never cached, since its replies cannot be tied to a message.
  private source = '';
  private skipped: unknown[] = [];
  private dispatching = false;
  private replaying = false;
  private pending: {key: string; replies: Uint8Array[]; ok: boolean} | null = null;
  /** `code` is a worker module bundled at build time, or a URL (blob: or a file in the build)
   *  whose script text runs as a classic worker. */
  constructor(code: string | URL | ((self: WorkerScope) => void), opts?: {name?: string}) {
    this.name = opts?.name ?? "";
    const g = globalThis as Record<string, any>;
    if (host.cache) {
      const url = typeof code === 'function' ? null : String(code), blob = url ? blobStore.get(url) as {bytes?: Uint8Array} | undefined : undefined;
      const source = typeof code === 'function' ? new g.TextEncoder().encode(code.toString()) : blob?.bytes ?? (url!.startsWith('blob:') ? null : host.readFile(resolveAssetPath(url!)));
      this.source = source ? hashBytes(source instanceof Uint8Array ? source : new Uint8Array(source)) : '';
      if (this.source && host.cache.get(asyncMark(this.source))) this.source = '';
    }
    try {
      if (typeof code === 'function') code(this.scope);
      else {
        const url = String(code), blob = blobStore.get(url) as {bytes?: Uint8Array} | undefined;
        const bytes = blob?.bytes ?? (url.startsWith('blob:') ? null : host.readFile(resolveAssetPath(url)));
        if (!bytes) throw Error('worker script not found: ' + url);
        const text = new g.TextDecoder().decode(bytes);
        // The worker sees its own self/postMessage/onmessage, and the page's fetch and WebAssembly.
        const scope = this.scope as unknown as Record<string, any>;
        scope.self = scope; scope.location = new g.URL(url.startsWith('blob:') ? 'http://localhost/worker.js' : url, 'http://localhost/'); scope.navigator = g.navigator;
        scope.importScripts = (...urls: string[]) => { for (const u of urls) { const b = host.readFile(resolveAssetPath(u)); if (b) new Function('self', new g.TextDecoder().decode(b))(scope); } };
        const run = new Function('self', 'globalThis', 'postMessage', 'addEventListener', 'removeEventListener', 'close', 'importScripts',
          `let onmessage = null;\n${text}\n;return () => onmessage;`);
        const handler = run(scope, scope, (d: unknown) => scope.postMessage(d), (t: string, f: Listener) => scope.addEventListener(t, f), (t: string, f: Listener) => scope.removeEventListener(t, f), () => scope.close(), scope.importScripts);
        const original = scope.dispatch.bind(scope);
        scope.dispatch = (data: unknown) => { if (!scope.onmessage) { const h = handler(); if (h) scope.onmessage = h; } original(data); };
      }
    } catch (error) { setTimeout(() => this.fail(error), 0); }
  }
  private fail(error: unknown) {
    const e = {message: String(error), error};
    this.onerror?.(e); for (const l of this.listeners.error ?? []) l(e as unknown as {data: unknown});
  }
  postMessage(data: unknown) {
    if (this.dead) return;
    // Hash the message now: the sender may reuse or transfer its buffers after posting.
    let key: string | null = null;
    if (host.cache && this.source) {
      const bytes = encode(data);
      if (bytes) key = 'jsgb-worker:' + hashBytes(bytes, this.source); else stats.unencodable++;
    }
    setTimeout(() => {
      if (this.dead) return;
      const hit = key && this.source ? host.cache!.get(key) : null;
      if (hit) {
        stats.hits++;
        this.skipped.push(data);
        for (const r of (decode(hit) as ArrayBuffer[]).map(b => decode(b))) this.deliverToOwner(r, true);
        return;
      }
      const t0 = Date.now();
      this.dispatching = true;
      try {
        if (this.skipped.length) {
          const replay = this.skipped; this.skipped = [];
          this.replaying = true;
          try { for (const d of replay) this.scope.dispatch(d); } finally { this.replaying = false; }
        }
        if (key && this.source) { stats.misses++; this.pending = {key, replies: [], ok: true}; }
        this.scope.dispatch(data);
      } catch (error) { this.pending = null; this.fail(error); }
      this.dispatching = false;
      const p = this.pending; this.pending = null;
      if (p?.ok && this.source) {
        const all = encode(p.replies.map(r => r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength)));
        if (all) { host.cache!.put(p.key, all.buffer as ArrayBuffer); stats.stored++; }
      }
      const ms = Date.now() - t0;
      if (ms > 200) (globalThis as {__jsgbHost?: {log(l: string, t: string): void}}).__jsgbHost?.log('warn', `worker ${this.name || '?'} job took ${ms} ms`);
    }, 0);
  }
  deliverToOwner(data: unknown, cached = false) {
    if (this.dead) return;
    if (!cached) {
      // Replies of replayed messages were already delivered from the cache.
      if (this.replaying) return;
      if (!this.dispatching && this.source) {
        // A reply outside message handling: this worker is never cached.
        host.cache!.put(asyncMark(this.source), new Uint8Array([1]).buffer);
        this.source = ''; this.pending = null; stats.asyncWorkers++;
        if (this.skipped.length) host.log('warn', `worker ${this.name || '?'} answered late after cached replies; results may repeat`);
      }
      if (this.pending) {
        const bytes = this.pending.ok ? encode(data) : null;
        if (bytes) this.pending.replies.push(bytes); else { this.pending.ok = false; stats.unencodable++; }
      }
    }
    setTimeout(() => { if (this.dead) return; const e = {data}; this.onmessage?.(e); for (const l of this.listeners.message ?? []) l(e); }, 0);
  }
  addEventListener(type: string, fn: Listener) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: Listener) { this.listeners[type] = (this.listeners[type] ?? []).filter(l => l !== fn); }
  terminate() { this.dead = true; }
}
/** A worker on its own thread with its own JavaScript engine, as in a browser (JsgbWorkers.cpp).
 *  Messages are copied as bytes; replies arrive when the runtime polls, once per frame. */
class ThreadWorker {
  onmessage: Listener | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  private listeners: Record<string, Listener[]> = {};
  private dead = false;
  constructor(readonly id: number, readonly name: string) {}
  postMessage(data: unknown) {
    if (this.dead) return;
    const bytes = encode(data);
    if (!bytes) { setTimeout(() => this.fail('postMessage: this value cannot be copied to a worker thread'), 0); return; }
    host.workerPost!(this.id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }
  deliver(bytes: ArrayBuffer, base = 0) {
    if (this.dead) return;
    const e = {data: decode(bytes, base)};
    this.onmessage?.(e); for (const l of this.listeners.message ?? []) l(e);
  }
  fail(message: string) {
    const e = {message, error: new Error(message)};
    this.onerror?.(e); for (const l of this.listeners.error ?? []) l(e as unknown as {data: unknown});
  }
  addEventListener(type: string, fn: Listener) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: Listener) { this.listeners[type] = (this.listeners[type] ?? []).filter(l => l !== fn); }
  terminate() { if (this.dead) return; this.dead = true; threads.delete(this.id); host.workerTerminate?.(this.id); }
}
const threads = new Map<number, ThreadWorker>();

/** Hands the replies of threaded workers to their owners; the runtime calls it once per frame. */
export function pollWorkers(): number {
  if (!threads.size || !host.workerPoll) return 0;
  const buf = host.workerPoll();
  if (!buf) return 0;
  let replies = 0;
  const words = new Int32Array(buf), text = new TextDecoder();
  for (let at = 0; at + 12 <= buf.byteLength;) {
    const id = words[at >> 2], kind = words[(at >> 2) + 1], n = words[(at >> 2) + 2];
    const start = at + 12;
    at = (at + 12 + n + 3) & ~3;
    const w = threads.get(id);
    if (!w) continue;
    replies++;
    // Read in place: a reply can be tens of megabytes, and decode copies each of its buffers out once.
    try { if (kind === 1) w.fail(text.decode(new Uint8Array(buf, start, n))); else w.deliver(buf, start); }
    catch (e) { host.log('error', `worker ${w.name || id}: ${e instanceof Error ? e.stack : e}`); }
  }
  return replies;
}

/** A worker given as source (a file or blob URL), or bundled with a standalone copy, runs on its own thread
 *  when the host supports it. Otherwise it runs on the game thread, as before. */
function WorkerFactory(code: string | URL | ((self: unknown) => void), opts?: {name?: string}) {
  // A worker bundled into the game also has a standalone bundle (its url) for a worker thread.
  const bundled = typeof code === 'function' ? (code as {url?: string}).url : undefined;
  if ((typeof code !== 'function' || bundled) && host.workerCreate) {
    const url = bundled ?? String(code), blob = blobStore.get(url) as {bytes?: Uint8Array} | undefined;
    const bytes = blob?.bytes ?? (url.startsWith('blob:') || url.startsWith('data:') ? null : host.readFile(resolveAssetPath(url)));
    if (bytes) {
      const name = opts?.name ?? '';
      const id = host.workerCreate(new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), url, name || url.split('/').pop() || 'worker');
      if (id > 0) { const w = new ThreadWorker(id, name); threads.set(id, w); return w; }
    }
  }
  return new UnrealWorker(code as never, opts);
}
// `new Worker(...)` and `class extends Worker` both get a threaded or a game-thread worker.
(globalThis as Record<string, unknown>).Worker = function Worker(this: unknown, code: string | URL | ((self: unknown) => void), opts?: {name?: string}) { return WorkerFactory(code, opts); };
