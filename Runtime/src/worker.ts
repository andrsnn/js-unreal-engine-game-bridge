import {host} from './host';
import {blobStore} from './polyfills';
import {resolveAssetPath} from './dom';
/** Web Workers run in the same V8 context on the Unreal target. Each worker module is bundled
 *  separately at build time; its code runs with a private `self`, and messages are delivered on
 *  later timer turns just as a real worker would deliver them. */
type Listener = (e: {data: unknown}) => void;

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
  /** `code` is a worker module bundled at build time, or a URL (blob: or a file in the build)
   *  whose script text runs as a classic worker. */
  constructor(code: string | URL | ((self: WorkerScope) => void), opts?: {name?: string}) {
    this.name = opts?.name ?? "";
    const g = globalThis as Record<string, any>;
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
    setTimeout(() => {
      if (this.dead) return;
      const t0 = Date.now();
      try { this.scope.dispatch(data); } catch (error) { this.fail(error); }
      const ms = Date.now() - t0;
      if (ms > 200) (globalThis as {__jsgbHost?: {log(l: string, t: string): void}}).__jsgbHost?.log('warn', `worker ${this.name || '?'} job took ${ms} ms`);
    }, 0);
  }
  deliverToOwner(data: unknown) {
    if (this.dead) return;
    setTimeout(() => { if (this.dead) return; const e = {data}; this.onmessage?.(e); for (const l of this.listeners.message ?? []) l(e); }, 0);
  }
  addEventListener(type: string, fn: Listener) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: Listener) { this.listeners[type] = (this.listeners[type] ?? []).filter(l => l !== fn); }
  terminate() { this.dead = true; }
}
(globalThis as Record<string, unknown>).Worker = UnrealWorker;
